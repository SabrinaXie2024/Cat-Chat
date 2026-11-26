// Package videos turns an untrusted upload into a metadata-free video plus
// a poster frame, using ffmpeg without re-encoding.
package videos

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const (
	MaxUploadBytes = 200 << 20 // 200 MB
	timeout        = 3 * time.Minute
)

var (
	ErrTooLarge    = errors.New("video must be at most 200 MB")
	ErrUnsupported = errors.New("only MP4 and WebM videos are supported")
	ErrCorrupt     = errors.New("could not read video")
)

type Result struct {
	// Path of the cleaned file (in a temp dir; caller moves or removes it).
	Path      string
	Container string // "mp4" | "webm"
	Poster    []byte // first frame as JPEG (raw; run through images.Process)
	Size      int64
}

// Processor wraps the ffmpeg binary.
type Processor struct {
	FFmpeg string // path to ffmpeg; "" = look up on PATH
}

func (p Processor) bin() string {
	if p.FFmpeg != "" {
		return p.FFmpeg
	}
	return "ffmpeg"
}

// Process copies at most MaxUploadBytes from r into workDir, checks the real
// container by content, then remuxes it dropping all global, per-stream and
// chapter metadata (GPS location, device model, titles, …). Streams are
// copied, never re-encoded, so quality is unchanged.
func (p Processor) Process(ctx context.Context, r io.Reader, workDir string) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	src, err := os.CreateTemp(workDir, "upload-*")
	if err != nil {
		return Result{}, err
	}
	defer os.Remove(src.Name())
	n, err := io.Copy(src, io.LimitReader(r, MaxUploadBytes+1))
	src.Close()
	if err != nil {
		return Result{}, err
	}
	if n > MaxUploadBytes {
		return Result{}, ErrTooLarge
	}

	container, err := sniff(src.Name())
	if err != nil {
		return Result{}, err
	}

	out := filepath.Join(workDir, fmt.Sprintf("clean-%d.%s", time.Now().UnixNano(), container))
	args := []string{
		"-v", "error", "-nostdin", "-y",
		// Only read local files, only with the demuxer we sniffed: ffmpeg
		// never follows URLs or guesses formats from hostile input.
		"-protocol_whitelist", "file",
		"-f", demuxer(container), "-i", src.Name(),
		"-map", "0:v", "-map", "0:a?",
		"-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1",
		"-c", "copy",
	}
	if container == "mp4" {
		args = append(args, "-movflags", "+faststart") // playable before fully downloaded
	}
	args = append(args, out)
	if err := p.run(ctx, args, nil); err != nil {
		os.Remove(out)
		return Result{}, ErrCorrupt
	}

	var poster bytes.Buffer
	err = p.run(ctx, []string{
		"-v", "error", "-nostdin", "-protocol_whitelist", "file",
		"-f", demuxer(container), "-i", out,
		"-frames:v", "1", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "3", "-",
	}, &poster)
	if err != nil || poster.Len() == 0 {
		os.Remove(out)
		return Result{}, ErrCorrupt
	}

	st, err := os.Stat(out)
	if err != nil {
		os.Remove(out)
		return Result{}, err
	}
	return Result{Path: out, Container: container, Poster: poster.Bytes(), Size: st.Size()}, nil
}

func (p Processor) run(ctx context.Context, args []string, stdout io.Writer) error {
	cmd := exec.CommandContext(ctx, p.bin(), args...)
	cmd.Stdout = stdout
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg: %w: %s", err, stderr.String())
	}
	return nil
}

func demuxer(container string) string {
	if container == "mp4" {
		return "mov,mp4,m4a,3gp,3g2,mj2"
	}
	return "matroska,webm"
}

func sniff(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	switch http.DetectContentType(head[:n]) {
	case "video/mp4":
		return "mp4", nil
	case "video/webm":
		return "webm", nil
	}
	return "", ErrUnsupported
}

// ContentType for serving.
func ContentType(container string) string {
	if container == "webm" {
		return "video/webm"
	}
	return "video/mp4"
}
