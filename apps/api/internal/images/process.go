// Package images turns an untrusted upload into a safe, normalized JPEG.
package images

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png" // register decoders
	"io"
	"net/http"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const (
	MaxUploadBytes = 5 << 20 // 5 MB, before processing
	MaxEdgePx      = 1920    // long edge after processing
	jpegQuality    = 85
	// Reject before full decode: a tiny file can declare a huge canvas
	// ("decompression bomb") and exhaust memory.
	maxSourcePixels = 50_000_000
	maxSourceEdgePx = 12_000
)

var (
	ErrTooLarge    = errors.New("image must be at most 5 MB")
	ErrUnsupported = errors.New("only JPEG, PNG and WebP images are supported")
	ErrDimensions  = errors.New("image dimensions are too large")
	ErrCorrupt     = errors.New("could not read image")
)

var allowed = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

type Result struct {
	JPEG          []byte
	Width, Height int
}

// Process reads at most MaxUploadBytes from r, verifies the real format by
// content (never the client's Content-Type), applies EXIF orientation,
// resizes to ≤ MaxEdgePx, flattens transparency onto white, and re-encodes
// as JPEG. Re-encoding drops all metadata (EXIF GPS, camera serials, …).
func Process(r io.Reader) (Result, error) {
	raw, err := io.ReadAll(io.LimitReader(r, MaxUploadBytes+1))
	if err != nil {
		return Result{}, err
	}
	if len(raw) > MaxUploadBytes {
		return Result{}, ErrTooLarge
	}
	if !allowed[sniff(raw)] {
		return Result{}, ErrUnsupported
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return Result{}, ErrCorrupt
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > maxSourceEdgePx || cfg.Height > maxSourceEdgePx ||
		cfg.Width*cfg.Height > maxSourcePixels {
		return Result{}, ErrDimensions
	}

	img, err := imaging.Decode(bytes.NewReader(raw), imaging.AutoOrientation(true))
	if err != nil {
		return Result{}, ErrCorrupt
	}
	b := img.Bounds()
	if b.Dx() > MaxEdgePx || b.Dy() > MaxEdgePx {
		img = imaging.Fit(img, MaxEdgePx, MaxEdgePx, imaging.Lanczos)
	}
	// JPEG has no alpha; transparent PNG/WebP areas would turn black.
	flat := imaging.New(img.Bounds().Dx(), img.Bounds().Dy(), color.White)
	flat = imaging.Overlay(flat, img, image.Pt(0, 0), 1.0)

	var out bytes.Buffer
	if err := jpeg.Encode(&out, flat, &jpeg.Options{Quality: jpegQuality}); err != nil {
		return Result{}, err
	}
	return Result{JPEG: out.Bytes(), Width: flat.Bounds().Dx(), Height: flat.Bounds().Dy()}, nil
}

func sniff(b []byte) string {
	// net/http's sniffer knows JPEG/PNG/WebP signatures.
	return http.DetectContentType(b)
}
