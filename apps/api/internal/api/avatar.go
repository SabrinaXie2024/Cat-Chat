package api

import "strings"

// DefaultAvatar is what new accounts get (an orange tabby).
var DefaultAvatar = Avatar{Breed: Shorthair, Coat: Orange, Pattern: Tabby, Eyes: Green}

// Valid reports whether every part is a known preset.
func (a Avatar) Valid() bool {
	return a.Breed.Valid() && a.Coat.Valid() && a.Pattern.Valid() && a.Eyes.Valid()
}

// String is the storage form, "breed.coat.pattern.eyes" (the users.avatar
// CHECK constraint validates the same shape).
func (a Avatar) String() string {
	return string(a.Breed) + "." + string(a.Coat) + "." + string(a.Pattern) + "." + string(a.Eyes)
}

// ParseAvatar reads the storage form; anything malformed falls back to
// DefaultAvatar (the database CHECK makes that unreachable in practice).
func ParseAvatar(s string) Avatar {
	p := strings.Split(s, ".")
	if len(p) != 4 {
		return DefaultAvatar
	}
	a := Avatar{Breed: AvatarBreed(p[0]), Coat: AvatarCoat(p[1]), Pattern: AvatarPattern(p[2]), Eyes: AvatarEyes(p[3])}
	if !a.Valid() {
		return DefaultAvatar
	}
	return a
}
