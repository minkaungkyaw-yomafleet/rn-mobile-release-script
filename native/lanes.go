package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type laneInfo struct {
	Name     string   `json:"name"`
	Private  bool     `json:"private"`
	Platform string   `json:"platform,omitempty"`
	Desc     string   `json:"desc,omitempty"`
	File     string   `json:"file"`
	Line     int      `json:"line"`
	Options  []string `json:"options"`
}

type lanesResult struct {
	DefaultPlatform string     `json:"defaultPlatform,omitempty"`
	Lanes           []laneInfo `json:"lanes"`
}

var (
	reLane     = regexp.MustCompile(`^(\s*)(private_lane|lane)\s+:(\w+)`)
	reDesc     = regexp.MustCompile(`^\s*desc\s+["'](.*)["']\s*$`)
	rePlatform = regexp.MustCompile(`^(\s*)platform\s+:(\w+)\s+do\b`)
	reDefault  = regexp.MustCompile(`^\s*default_platform\(\s*:(\w+)\s*\)`)
	reImport   = regexp.MustCompile(`^\s*import\s+["']([^"']+)["']`)
	reOption   = regexp.MustCompile(`options\[:(\w+)\]`)
	reEnd      = regexp.MustCompile(`^(\s*)end\b`)
)

type platformFrame struct {
	indent int
	name   string
}

// runLanes statically reads <dir>/fastlane/Fastfile and every file it imports.
// It is a line scanner, not a Ruby parser: it relies on lanes being closed by an
// `end` at the same indentation as the `lane` line, which every Fastfile in our repos does.
func runLanes(args []string) (any, error) {
	fs := flag.NewFlagSet("lanes", flag.ContinueOnError)
	dir := fs.String("dir", "", "platform directory that contains fastlane/ (e.g. ./ios)")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	if *dir == "" {
		return nil, fmt.Errorf("--dir is required")
	}
	base, err := filepath.Abs(filepath.Join(*dir, "fastlane"))
	if err != nil {
		return nil, err
	}
	fastfile := filepath.Join(base, "Fastfile")
	if _, err := os.Stat(fastfile); err != nil {
		return nil, fmt.Errorf("no Fastfile at %s", fastfile)
	}

	res := &lanesResult{Lanes: []laneInfo{}}
	if err := parseFastfile(fastfile, base, "", map[string]bool{}, res); err != nil {
		return nil, err
	}
	return res, nil
}

func indentOf(line string) int {
	return len(line) - len(strings.TrimLeft(line, " \t"))
}

func parseFastfile(path, base, inheritedPlatform string, visited map[string]bool, res *lanesResult) error {
	if visited[path] {
		return nil
	}
	visited[path] = true

	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	rel, _ := filepath.Rel(base, path)

	var (
		stack       []platformFrame
		cur         *laneInfo
		curIndent   int
		pendingDesc string
		lineNo      int
		opts        = map[string]bool{}
	)
	platform := func() string {
		if len(stack) > 0 {
			return stack[len(stack)-1].name
		}
		return inheritedPlatform
	}

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		lineNo++
		line := sc.Text()
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}

		// Inside a lane body: collect options and watch for the closing `end`.
		if cur != nil {
			for _, m := range reOption.FindAllStringSubmatch(line, -1) {
				opts[m[1]] = true
			}
			if m := reEnd.FindStringSubmatch(line); m != nil && len(m[1]) == curIndent {
				cur.Options = sortedKeys(opts)
				res.Lanes = append(res.Lanes, *cur)
				cur, opts = nil, map[string]bool{}
			}
			continue
		}

		if m := reDefault.FindStringSubmatch(line); m != nil {
			res.DefaultPlatform = m[1]
			continue
		}
		if m := rePlatform.FindStringSubmatch(line); m != nil {
			stack = append(stack, platformFrame{indent: len(m[1]), name: m[2]})
			continue
		}
		if m := reEnd.FindStringSubmatch(line); m != nil && len(stack) > 0 && len(m[1]) == stack[len(stack)-1].indent {
			stack = stack[:len(stack)-1]
			continue
		}
		if m := reDesc.FindStringSubmatch(line); m != nil {
			// Several consecutive desc lines are usage notes; keep the first as the summary.
			if pendingDesc == "" {
				pendingDesc = m[1]
			}
			continue
		}
		if m := reImport.FindStringSubmatch(line); m != nil {
			if target := resolveImport(path, base, m[1]); target != "" {
				if err := parseFastfile(target, base, platform(), visited, res); err != nil {
					return err
				}
			}
			continue
		}
		if m := reLane.FindStringSubmatch(line); m != nil {
			cur = &laneInfo{
				Name:     m[3],
				Private:  m[2] == "private_lane",
				Platform: platform(),
				Desc:     pendingDesc,
				File:     rel,
				Line:     lineNo,
				Options:  []string{},
			}
			curIndent = len(m[1])
			pendingDesc = ""
			// A one-line lane (`lane :x do ... end`) never reaches the body loop.
			if strings.HasSuffix(strings.TrimSpace(line), " end") {
				res.Lanes = append(res.Lanes, *cur)
				cur = nil
			}
		}
	}
	return sc.Err()
}

// resolveImport returns an absolute path for an `import "x.rb"` target, or "" if it
// does not exist or points outside the fastlane directory.
func resolveImport(importer, base, target string) string {
	for _, from := range []string{filepath.Dir(importer), base} {
		cand := filepath.Join(from, target)
		rel, err := filepath.Rel(base, cand)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		if st, err := os.Stat(cand); err == nil && st.Mode().IsRegular() {
			return cand
		}
	}
	return ""
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
