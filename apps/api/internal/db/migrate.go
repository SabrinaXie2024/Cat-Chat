// Package db owns the schema (goose migrations, embedded) and the
// sqlc-generated query layer in ./dbq.
package db

//go:generate go tool sqlc generate -f ../../sqlc.yaml

import (
	"context"
	"database/sql"
	"embed"
	"io/fs"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Migrate applies all pending migrations. Safe to run on every boot.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	provider, err := goose.NewProvider(goose.DialectPostgres, stdlibDB(pool), mustSub(migrations, "migrations"),
		goose.WithDisableGlobalRegistry(true))
	if err != nil {
		return err
	}
	_, err = provider.Up(ctx)
	return err
}

func stdlibDB(pool *pgxpool.Pool) *sql.DB { return stdlib.OpenDBFromPool(pool) }

func mustSub(fsys embed.FS, dir string) fs.FS {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		panic(err)
	}
	return sub
}
