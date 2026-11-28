-- +goose Up
-- Four more preset cats (mirrors the Avatar enum in openapi.yaml).
ALTER TABLE users DROP CONSTRAINT users_avatar_check;
ALTER TABLE users ADD CONSTRAINT users_avatar_check
    CHECK (avatar IN ('orange', 'black', 'white', 'gray', 'calico', 'siamese', 'tuxedo', 'tabby',
                      'silver', 'tortie', 'cream', 'orange-white'));

-- +goose Down
UPDATE users SET avatar = 'orange' WHERE avatar IN ('silver', 'tortie', 'cream', 'orange-white');
ALTER TABLE users DROP CONSTRAINT users_avatar_check;
ALTER TABLE users ADD CONSTRAINT users_avatar_check
    CHECK (avatar IN ('orange', 'black', 'white', 'gray', 'calico', 'siamese', 'tuxedo', 'tabby'));
