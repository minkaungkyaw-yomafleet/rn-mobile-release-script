package main

import (
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

type cleanEntry struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	Status string `json:"status"` // removed | would-remove | absent | skipped | error
	Detail string `json:"detail,omitempty"`
}

type cleanResult struct {
	DryRun     bool         `json:"dryRun"`
	Entries    []cleanEntry `json:"entries"`
	TotalBytes int64        `json:"totalBytes"`
}

// Build output only. Pods, Podfile.lock, .gradle and node_modules are deliberately
// left alone: removing them forces slow re-downloads and can change lockfiles.
var rootTargets = map[string][]string{
	"android": {"android/app/build", "android/app/.cxx", "android/build"},
	"ios":     {"ios/build"},
	"common":  {"node_modules/.cache"},
}

// What `react-native start --reset-cache` clears, without starting a server.
var tempGlobs = []string{"metro-*", "haste-map-*", "react-native-packager-cache-*"}

func runClean(args []string) (any, error) {
	flags := flag.NewFlagSet("clean", flag.ContinueOnError)
	root := flags.String("root", ".", "project root")
	platform := flags.String("platform", "all", "android | ios | all")
	dry := flags.Bool("dry-run", false, "report what would be removed")
	tempDir := flags.String("temp-dir", "", "directory holding Metro caches (default: system temp dir; tests point this at a sandbox)")
	if err := flags.Parse(args); err != nil {
		return nil, err
	}

	absRoot, err := filepath.Abs(*root)
	if err != nil {
		return nil, err
	}
	// Guard against `--root /` or a typo: only act inside something that is a JS project.
	if _, err := os.Stat(filepath.Join(absRoot, "package.json")); err != nil {
		return nil, fmt.Errorf("%s has no package.json, refusing to clean", absRoot)
	}

	groups := []string{"common"}
	switch *platform {
	case "android", "ios":
		groups = append(groups, *platform)
	case "all":
		groups = append(groups, "android", "ios")
	default:
		return nil, fmt.Errorf("unknown platform %q", *platform)
	}

	var targets []string
	for _, g := range groups {
		for _, rel := range rootTargets[g] {
			targets = append(targets, filepath.Join(absRoot, rel))
		}
	}
	tmp := *tempDir
	if tmp == "" {
		tmp = os.TempDir()
	}
	// macOS TMPDIR ends with a slash; Clean so the parent comparison in removeTarget holds.
	tmp = filepath.Clean(tmp)
	for _, pattern := range tempGlobs {
		matches, _ := filepath.Glob(filepath.Join(tmp, pattern))
		targets = append(targets, matches...)
	}

	entries := make([]cleanEntry, len(targets))
	var wg sync.WaitGroup
	for i, t := range targets {
		wg.Add(1)
		go func(i int, t string) {
			defer wg.Done()
			entries[i] = removeTarget(t, absRoot, tmp, *dry)
		}(i, t)
	}
	wg.Wait()

	sort.Slice(entries, func(a, b int) bool { return entries[a].Path < entries[b].Path })
	res := cleanResult{DryRun: *dry, Entries: entries}
	for _, e := range entries {
		if e.Status == "removed" || e.Status == "would-remove" {
			res.TotalBytes += e.Bytes
		}
	}
	return res, nil
}

func removeTarget(path, root, tmp string, dry bool) cleanEntry {
	e := cleanEntry{Path: path}

	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		e.Status = "absent"
		return e
	}
	if err != nil {
		e.Status, e.Detail = "error", err.Error()
		return e
	}
	// Never follow or delete through a symlink; a link could point outside the project.
	if info.Mode()&os.ModeSymlink != 0 {
		e.Status, e.Detail = "skipped", "symlink"
		return e
	}
	if parent := filepath.Dir(path); parent != tmp && !isUnder(path, root) {
		e.Status, e.Detail = "skipped", "outside project and temp dir"
		return e
	}

	e.Bytes = dirSize(path)
	if dry {
		e.Status = "would-remove"
		return e
	}
	if err := os.RemoveAll(path); err != nil {
		e.Status, e.Detail = "error", err.Error()
		return e
	}
	e.Status = "removed"
	return e
}

func isUnder(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != "." && rel != ".." && !hasDotDotPrefix(rel)
}

func hasDotDotPrefix(rel string) bool {
	return len(rel) >= 3 && rel[:2] == ".." && rel[2] == filepath.Separator
}

func dirSize(path string) int64 {
	var total int64
	_ = filepath.WalkDir(path, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil && info.Mode().IsRegular() {
			total += info.Size()
		}
		return nil
	})
	return total
}
