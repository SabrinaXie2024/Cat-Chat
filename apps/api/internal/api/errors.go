package api

import "errors"

// Store sentinel errors. Defined here (not in store) because store imports
// this package for the model types.
var (
	ErrNotFound   = errors.New("not found")
	ErrThreadFull = errors.New("thread is full")
	ErrEmailTaken = errors.New("email already registered")
)
