package api

import "errors"

// Store sentinel errors. Defined here (not in store) because store imports
// this package for the model types.
var (
	ErrNotFound   = errors.New("not found")
	ErrThreadFull = errors.New("thread is full")
	ErrEmailTaken = errors.New("email already registered")
	// ErrInvalidImages: a referenced image doesn't exist or isn't the author's.
	ErrInvalidImages = errors.New("invalid image reference")
	// ErrInvalidMedia: gallery media doesn't exist or wasn't uploaded by the admin.
	ErrInvalidMedia = errors.New("invalid media reference")
	// ErrSelfFollow: users can't follow themselves.
	ErrSelfFollow = errors.New("cannot follow yourself")
)
