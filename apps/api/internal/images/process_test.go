package images

import (
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func encodePNG(t *testing.T, w, h int, c color.Color) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func encodeJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h)), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// withEXIF splices an APP1 EXIF segment (orientation + a fake GPS tag
// marker string) right after the JPEG SOI marker.
func withEXIF(t *testing.T, jpg []byte, orientation uint16) []byte {
	t.Helper()
	var tiff bytes.Buffer
	tiff.WriteString("MM\x00\x2a\x00\x00\x00\x08")   // big-endian TIFF header, IFD at 8
	binary.Write(&tiff, binary.BigEndian, uint16(1)) // 1 entry
	binary.Write(&tiff, binary.BigEndian, uint16(0x0112))
	binary.Write(&tiff, binary.BigEndian, uint16(3)) // SHORT
	binary.Write(&tiff, binary.BigEndian, uint32(1))
	binary.Write(&tiff, binary.BigEndian, orientation)
	binary.Write(&tiff, binary.BigEndian, uint16(0))
	binary.Write(&tiff, binary.BigEndian, uint32(0)) // no next IFD
	tiff.WriteString("GPS-SECRET-31.2304N")          // stands in for location data
	payload := append([]byte("Exif\x00\x00"), tiff.Bytes()...)
	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2))
	out := append([]byte{}, jpg[:2]...)
	out = append(out, seg...)
	out = append(out, payload...)
	return append(out, jpg[2:]...)
}

func TestProcessResizesAndReencodes(t *testing.T) {
	res, err := Process(bytes.NewReader(encodePNG(t, 4000, 1000, color.NRGBA{255, 0, 0, 255})))
	if err != nil {
		t.Fatal(err)
	}
	if res.Width != 1920 || res.Height != 480 {
		t.Fatalf("got %dx%d, want 1920x480", res.Width, res.Height)
	}
	if !bytes.HasPrefix(res.JPEG, []byte{0xFF, 0xD8}) {
		t.Fatal("output is not JPEG")
	}
}

func TestProcessKeepsSmallImages(t *testing.T) {
	res, err := Process(bytes.NewReader(encodeJPEG(t, 800, 600)))
	if err != nil || res.Width != 800 || res.Height != 600 {
		t.Fatalf("%dx%d %v", res.Width, res.Height, err)
	}
}

func TestProcessAppliesOrientationAndStripsEXIF(t *testing.T) {
	// Orientation 6 = "rotate 90° CW to display": a 400x200 sensor image is
	// a portrait photo.
	src := withEXIF(t, encodeJPEG(t, 400, 200), 6)
	if !bytes.Contains(src, []byte("GPS-SECRET")) {
		t.Fatal("test fixture broken")
	}
	res, err := Process(bytes.NewReader(src))
	if err != nil {
		t.Fatal(err)
	}
	if res.Width != 200 || res.Height != 400 {
		t.Fatalf("orientation not applied: got %dx%d, want 200x400", res.Width, res.Height)
	}
	if bytes.Contains(res.JPEG, []byte("GPS-SECRET")) || bytes.Contains(res.JPEG, []byte("Exif")) {
		t.Fatal("metadata survived processing")
	}
}

func TestProcessFlattensTransparencyOntoWhite(t *testing.T) {
	res, err := Process(bytes.NewReader(encodePNG(t, 10, 10, color.NRGBA{0, 0, 0, 0})))
	if err != nil {
		t.Fatal(err)
	}
	img, _ := jpeg.Decode(bytes.NewReader(res.JPEG))
	r, g, b, _ := img.At(5, 5).RGBA()
	if r>>8 < 250 || g>>8 < 250 || b>>8 < 250 {
		t.Fatalf("transparent pixel became (%d,%d,%d), want white", r>>8, g>>8, b>>8)
	}
}

func TestProcessRejects(t *testing.T) {
	gif := []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;")
	html := []byte("<html><script>alert(1)</script></html>")
	tooBig := append(encodeJPEG(t, 10, 10), make([]byte, MaxUploadBytes)...)

	// PNG header declaring 20000x20000 (decompression bomb) without pixel data.
	bomb := encodePNG(t, 1, 1, color.Black)
	binary.BigEndian.PutUint32(bomb[16:], 20000)
	binary.BigEndian.PutUint32(bomb[20:], 20000)
	binary.BigEndian.PutUint32(bomb[29:], crc32.ChecksumIEEE(bomb[12:29])) // valid IHDR CRC

	truncated := encodeJPEG(t, 100, 100)[:200]

	cases := []struct {
		name string
		in   []byte
		want error
	}{
		{"gif", gif, ErrUnsupported},
		{"html disguised as upload", html, ErrUnsupported},
		{"over 5MB", tooBig, ErrTooLarge},
		{"decompression bomb", bomb, ErrDimensions},
		{"truncated jpeg", truncated, ErrCorrupt},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Process(bytes.NewReader(tc.in)); !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}
