-- +goose Up
-- Avatars become a combination of preset parts, stored as
-- "breed.coat.pattern.eyes" (mirrors the Avatar schema in openapi.yaml).
-- The old one-piece presets map to their equivalent combination.
ALTER TABLE users DROP CONSTRAINT users_avatar_check;
UPDATE users SET avatar = CASE avatar
    WHEN 'orange'       THEN 'shorthair.orange.tabby.green'
    WHEN 'black'        THEN 'shorthair.black.solid.yellow'
    WHEN 'white'        THEN 'shorthair.white.solid.blue'
    WHEN 'gray'         THEN 'shorthair.gray.solid.green'
    WHEN 'calico'       THEN 'shorthair.white.patches.amber'
    WHEN 'siamese'      THEN 'shorthair.cream.pointed.blue'
    WHEN 'tuxedo'       THEN 'shorthair.black.bicolor.green'
    WHEN 'tabby'        THEN 'shorthair.brown.tabby.green'
    WHEN 'silver'       THEN 'shorthair.silver.tabby.green'
    WHEN 'tortie'       THEN 'shorthair.black.patches.yellow'
    WHEN 'cream'        THEN 'shorthair.cream.tabby.amber'
    WHEN 'orange-white' THEN 'shorthair.orange.bicolor.green'
    WHEN 'lihua'        THEN 'shorthair.brown.mackerel.green'
    ELSE 'shorthair.orange.tabby.green'
END;
ALTER TABLE users ALTER COLUMN avatar SET DEFAULT 'shorthair.orange.tabby.green';
ALTER TABLE users ADD CONSTRAINT users_avatar_check CHECK (avatar ~ (
    '^(shorthair|fold|longhair|maine)'
    || '\.(orange|cream|brown|gray|silver|black|white)'
    || '\.(solid|tabby|mackerel|bicolor|patches|pointed)'
    || '\.(green|yellow|blue|amber|odd)$'));

-- +goose Down
ALTER TABLE users DROP CONSTRAINT users_avatar_check;
UPDATE users SET avatar = CASE avatar
    WHEN 'shorthair.black.solid.yellow'    THEN 'black'
    WHEN 'shorthair.white.solid.blue'      THEN 'white'
    WHEN 'shorthair.gray.solid.green'      THEN 'gray'
    WHEN 'shorthair.white.patches.amber'   THEN 'calico'
    WHEN 'shorthair.cream.pointed.blue'    THEN 'siamese'
    WHEN 'shorthair.black.bicolor.green'   THEN 'tuxedo'
    WHEN 'shorthair.brown.tabby.green'     THEN 'tabby'
    WHEN 'shorthair.silver.tabby.green'    THEN 'silver'
    WHEN 'shorthair.black.patches.yellow'  THEN 'tortie'
    WHEN 'shorthair.cream.tabby.amber'     THEN 'cream'
    WHEN 'shorthair.orange.bicolor.green'  THEN 'orange-white'
    WHEN 'shorthair.brown.mackerel.green'  THEN 'lihua'
    ELSE 'orange'
END;
ALTER TABLE users ALTER COLUMN avatar SET DEFAULT 'orange';
ALTER TABLE users ADD CONSTRAINT users_avatar_check
    CHECK (avatar IN ('orange', 'black', 'white', 'gray', 'calico', 'siamese', 'tuxedo', 'tabby',
                      'silver', 'tortie', 'cream', 'orange-white', 'lihua'));
