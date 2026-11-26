package videos

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func needFFmpeg(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
}

// makeVideo renders a 1s test clip with GPS/title metadata baked in.
func makeVideo(t *testing.T, ext string) []byte {
	t.Helper()
	out := filepath.Join(t.TempDir(), "in."+ext)
	codec := []string{"-c:v", "libx264", "-pix_fmt", "yuv420p"}
	if ext == "webm" {
		codec = []string{"-c:v", "libvpx-vp9", "-b:v", "100k"}
	}
	args := append([]string{"-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10", "-t", "1"}, codec...)
	args = append(args, "-metadata", "location=+31.2304+121.4737/", "-metadata", "title=SECRET-TITLE",
		"-metadata:s:v:0", "handler_name=SECRET-HANDLER", out)
	if b, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("make fixture: %v %s", err, b)
	}
	b, _ := os.ReadFile(out)
	return b
}

func TestProcessStripsMetadataAndMakesPoster(t *testing.T) {
	needFFmpeg(t)
	for _, ext := range []string{"mp4", "webm"} {
		t.Run(ext, func(t *testing.T) {
			src := makeVideo(t, ext)
			srcPath := filepath.Join(t.TempDir(), "src."+ext)
			_ = os.WriteFile(srcPath, src, 0o600)
			if tags := probeTags(t, srcPath); !bytes.Contains(tags, []byte("31.2304")) || !bytes.Contains(tags, []byte("SECRET-TITLE")) {
				t.Fatalf("fixture missing metadata: %s", tags)
			}
			res, err := Processor{}.Process(context.Background(), bytes.NewReader(src), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if res.Container != ext {
				t.Fatalf("container %q", res.Container)
			}
			tags := probeTags(t, res.Path)
			raw, _ := os.ReadFile(res.Path)
			for _, secret := range []string{"31.2304", "SECRET-TITLE", "SECRET-HANDLER"} {
				if bytes.Contains(tags, []byte(secret)) || bytes.Contains(raw, []byte(secret)) {
					t.Errorf("%q survived: %s", secret, tags)
				}
			}
			if !bytes.HasPrefix(res.Poster, []byte{0xFF, 0xD8}) {
				t.Fatal("poster is not a JPEG")
			}
		})
	}
}

// probeTags returns every container and stream tag ffprobe can see.
func probeTags(t *testing.T, path string) []byte {
	t.Helper()
	out, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "compact", path).Output()
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestProcessRejects(t *testing.T) {
	needFFmpeg(t)
	mp4 := makeVideo(t, "mp4")
	cases := map[string]struct {
		in   []byte
		want error
	}{
		"not a video":   {[]byte("<html>hello</html>"), ErrUnsupported},
		"gif":           {[]byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"), ErrUnsupported},
		"truncated mp4": {mp4[:len(mp4)/3], ErrCorrupt},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := Processor{}.Process(context.Background(), bytes.NewReader(tc.in), t.TempDir())
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}

func TestProcessRejectsOversize(t *testing.T) {
	// No ffmpeg needed: the size check happens while copying.
	big := bytes.NewReader(make([]byte, MaxUploadBytes+1))
	if _, err := (Processor{}).Process(context.Background(), big, t.TempDir()); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("got %v", err)
	}
}
