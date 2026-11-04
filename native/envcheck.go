package main

import (
	"flag"
	"os"
	"sort"
)

type envCheckResult struct {
	Path      string   `json:"path"`
	Exists    bool     `json:"exists"`
	NonEmpty  bool     `json:"nonEmpty"`
	KeyCount  int      `json:"keyCount"`
	EmptyKeys []string `json:"emptyKeys"`
}

// runEnvCheck reports whether an env file exists and has content. It returns key
// names only, never values.
func runEnvCheck(args []string) (any, error) {
	fs := flag.NewFlagSet("envcheck", flag.ContinueOnError)
	root := fs.String("root", ".", "project root")
	file := fs.String("file", "", "env file path relative to root")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}

	full, err := resolveInside(*root, *file)
	if err != nil {
		return nil, err
	}
	res := envCheckResult{Path: *file, EmptyKeys: []string{}}

	info, err := os.Stat(full)
	if os.IsNotExist(err) {
		return res, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return res, nil
	}
	res.Exists = true
	res.NonEmpty = info.Size() > 0

	pairs, err := parseDotenv(full)
	if err != nil {
		return nil, err
	}
	res.KeyCount = len(pairs)
	for _, p := range pairs {
		if p.Value == "" {
			res.EmptyKeys = append(res.EmptyKeys, p.Key)
		}
	}
	sort.Strings(res.EmptyKeys)
	return res, nil
}
