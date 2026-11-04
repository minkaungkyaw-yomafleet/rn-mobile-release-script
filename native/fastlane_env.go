package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type fastlaneEnvResult struct {
	EnvFile         bool     `json:"envFile"`
	ExampleOnly     bool     `json:"exampleOnly"`
	KeyCount        int      `json:"keyCount"`
	EmptyKeys       []string `json:"emptyKeys"`
	MissingPathVars []string `json:"missingPathVars"`
}

// Variables that point at a credentials or signing file (service account JSON,
// Play Store key, keystore, .p8 key).
var (
	pathVarName  = regexp.MustCompile(`(_FILE|_PATH|_CREDENTIALS|_JSON_KEY)$`)
	pathVarValue = regexp.MustCompile(`(/|\.json$|\.p8$|\.jks$|\.keystore$|\.pem$|\.p12$)`)
)

// runFastlaneEnv is the "do I have access" check for a Fastlane project. It looks at
// <dir>/fastlane/.env, which Fastlane loads automatically, and verifies that every
// variable pointing at a credentials file points at a file that exists. It reports
// variable names only, never values.
func runFastlaneEnv(args []string) (any, error) {
	fs := flag.NewFlagSet("fastlane-env", flag.ContinueOnError)
	dir := fs.String("dir", "", "platform directory that contains fastlane/")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	if *dir == "" {
		return nil, fmt.Errorf("--dir is required")
	}
	absDir, err := filepath.Abs(*dir)
	if err != nil {
		return nil, err
	}
	flDir := filepath.Join(absDir, "fastlane")
	res := fastlaneEnvResult{EmptyKeys: []string{}, MissingPathVars: []string{}}

	envPath := filepath.Join(flDir, ".env")
	if _, err := os.Stat(envPath); err != nil {
		if _, exErr := os.Stat(filepath.Join(flDir, ".env.example")); exErr == nil {
			res.ExampleOnly = true
		}
		return res, nil
	}
	res.EnvFile = true

	pairs, err := parseDotenv(envPath)
	if err != nil {
		return nil, err
	}
	res.KeyCount = len(pairs)
	for _, p := range pairs {
		if p.Value == "" {
			res.EmptyKeys = append(res.EmptyKeys, p.Key)
			continue
		}
		if !pathVarName.MatchString(p.Key) || strings.HasPrefix(p.Value, "{") || !pathVarValue.MatchString(p.Value) {
			continue
		}
		if !anyExists(p.Value, absDir, flDir) {
			res.MissingPathVars = append(res.MissingPathVars, p.Key)
		}
	}
	sort.Strings(res.EmptyKeys)
	sort.Strings(res.MissingPathVars)
	return res, nil
}

// anyExists resolves a value the way these projects use it: absolute, ~/..., or
// relative to the platform dir (where fastlane runs) or the fastlane dir.
func anyExists(value string, bases ...string) bool {
	if strings.HasPrefix(value, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			value = filepath.Join(home, value[2:])
		}
	}
	if filepath.IsAbs(value) {
		_, err := os.Stat(value)
		return err == nil
	}
	for _, b := range bases {
		if _, err := os.Stat(filepath.Join(b, value)); err == nil {
			return true
		}
	}
	return false
}
