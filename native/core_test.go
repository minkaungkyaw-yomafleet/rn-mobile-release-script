package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func asJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestLanesImportsPlatformAndOptions(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "fastlane/Fastfile"), `
default_platform(:ios)
platform :ios do
  import "lanes/dev.rb"
  # lane :commented_out do
  # end
  desc "Top level"
  lane :top do |options|
    puts options[:clean]
  end
end
`)
	write(t, filepath.Join(dir, "fastlane/lanes/dev.rb"), `
desc "Build dev"
desc "usage note"
lane :build_dev do |options|
  x = options[:ipa] || options[:version]
  if x
    puts "nested"
  end
end

private_lane :helper do
end
`)
	got, err := runLanes([]string{"--dir", dir})
	if err != nil {
		t.Fatal(err)
	}
	res := got.(*lanesResult)
	if res.DefaultPlatform != "ios" {
		t.Errorf("default platform = %q", res.DefaultPlatform)
	}
	byName := map[string]laneInfo{}
	for _, l := range res.Lanes {
		byName[l.Name] = l
	}
	if _, ok := byName["commented_out"]; ok {
		t.Error("commented lane must be ignored")
	}
	bd, ok := byName["build_dev"]
	if !ok {
		t.Fatalf("build_dev missing: %v", asJSON(t, res))
	}
	if bd.Platform != "ios" {
		t.Errorf("imported lane should inherit platform, got %q", bd.Platform)
	}
	if bd.Desc != "Build dev" {
		t.Errorf("desc = %q, want first desc line", bd.Desc)
	}
	if strings.Join(bd.Options, ",") != "ipa,version" {
		t.Errorf("options = %v", bd.Options)
	}
	if !byName["helper"].Private {
		t.Error("helper should be private")
	}
	if byName["top"].Platform != "ios" || strings.Join(byName["top"].Options, ",") != "clean" {
		t.Errorf("top = %+v", byName["top"])
	}
}

func TestLanesRejectsImportOutsideFastlaneDir(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "secret.rb"), "lane :leaked do\nend\n")
	write(t, filepath.Join(dir, "fastlane/Fastfile"), "import \"../secret.rb\"\n")
	got, err := runLanes([]string{"--dir", dir})
	if err != nil {
		t.Fatal(err)
	}
	if n := len(got.(*lanesResult).Lanes); n != 0 {
		t.Errorf("expected no lanes from an escaping import, got %d", n)
	}
}

func TestCleanRefusesWithoutPackageJSON(t *testing.T) {
	if _, err := runClean([]string{"--root", t.TempDir(), "--temp-dir", t.TempDir()}); err == nil {
		t.Fatal("expected refusal in a directory without package.json")
	}
}

func TestCleanRemovesBuildDirsAndSkipsSymlinks(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	// Sandboxed stand-in for the system temp dir so the test never touches real Metro caches.
	sandboxTmp := t.TempDir()
	write(t, filepath.Join(sandboxTmp, "metro-cache-test/blob"), "abc")
	write(t, filepath.Join(sandboxTmp, "unrelated-file"), "keep")
	write(t, filepath.Join(root, "package.json"), "{}")
	write(t, filepath.Join(root, "android/app/build/out.bin"), "12345")
	write(t, filepath.Join(root, "ios/build/keep-me-on-android-only.txt"), "x")
	write(t, filepath.Join(outside, "precious.txt"), "do not delete")
	if err := os.MkdirAll(filepath.Join(root, "android/build/.."), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "android/build")); err != nil {
		t.Fatal(err)
	}

	dry, err := runClean([]string{"--root", root, "--platform", "android", "--dry-run", "--temp-dir", sandboxTmp})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "android/app/build/out.bin")); err != nil {
		t.Fatal("dry-run must not delete anything")
	}
	// 5 bytes of android build output + 3 bytes of sandboxed Metro cache.
	if dry.(cleanResult).TotalBytes != 8 {
		t.Errorf("dry-run bytes = %d, want 8", dry.(cleanResult).TotalBytes)
	}

	if _, err := runClean([]string{"--root", root, "--platform", "android", "--temp-dir", sandboxTmp}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(sandboxTmp, "metro-cache-test")); !os.IsNotExist(err) {
		t.Error("sandboxed metro cache should be removed")
	}
	if _, err := os.Stat(filepath.Join(sandboxTmp, "unrelated-file")); err != nil {
		t.Error("files that do not match the Metro globs must survive")
	}
	if _, err := os.Stat(filepath.Join(root, "android/app/build")); !os.IsNotExist(err) {
		t.Error("android/app/build should be gone")
	}
	if _, err := os.Stat(filepath.Join(root, "ios/build")); err != nil {
		t.Error("ios/build must survive an android-only clean")
	}
	if _, err := os.Stat(filepath.Join(outside, "precious.txt")); err != nil {
		t.Fatal("clean followed a symlink out of the project")
	}
}

func TestEnvCheckNeverEmitsValues(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, ".env.qa"), "# c\nAPI_URL=https://qa.example.test\nexport TOKEN=\"s3cr3t-value\"\nEMPTY=\n")

	got, err := runEnvCheck([]string{"--root", root, "--file", ".env.qa"})
	if err != nil {
		t.Fatal(err)
	}
	res := got.(envCheckResult)
	if !res.Exists || !res.NonEmpty || res.KeyCount != 3 {
		t.Errorf("unexpected result: %+v", res)
	}
	if strings.Join(res.EmptyKeys, ",") != "EMPTY" {
		t.Errorf("emptyKeys = %v", res.EmptyKeys)
	}
	out := asJSON(t, res)
	for _, leak := range []string{"s3cr3t-value", "qa.example.test"} {
		if strings.Contains(out, leak) {
			t.Errorf("output leaked a value: %s", out)
		}
	}
}

func TestEnvCheckMissingAndEscaping(t *testing.T) {
	root := t.TempDir()
	got, err := runEnvCheck([]string{"--root", root, "--file", ".env.nope"})
	if err != nil || got.(envCheckResult).Exists {
		t.Fatalf("missing file should report exists=false, got %+v err=%v", got, err)
	}
	for _, bad := range []string{"../.env", "/etc/passwd"} {
		if _, err := runEnvCheck([]string{"--root", root, "--file", bad}); err == nil {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
}

func TestFastlaneEnvFlagsMissingCredentialFilesByName(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "fastlane/.env"), strings.Join([]string{
		"FIREBASE_LOGIN_CREDENTIALS=./creds/missing.json",
		"PLAY_STORE_CREDENTIALS=./creds/present.json",
		"INLINE_CREDENTIALS={\"type\":\"service_account\"}",
		"SENTRY_AUTH_TOKEN=",
		"APP_NAME=plus",
	}, "\n"))
	write(t, filepath.Join(dir, "creds/present.json"), "{}")

	got, err := runFastlaneEnv([]string{"--dir", dir})
	if err != nil {
		t.Fatal(err)
	}
	res := got.(fastlaneEnvResult)
	if !res.EnvFile {
		t.Fatal("envFile should be true")
	}
	if strings.Join(res.MissingPathVars, ",") != "FIREBASE_LOGIN_CREDENTIALS" {
		t.Errorf("missingPathVars = %v", res.MissingPathVars)
	}
	if strings.Join(res.EmptyKeys, ",") != "SENTRY_AUTH_TOKEN" {
		t.Errorf("emptyKeys = %v", res.EmptyKeys)
	}
	if strings.Contains(asJSON(t, res), "missing.json") {
		t.Error("output must not contain env values")
	}
}

func TestFastlaneEnvExampleOnly(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "fastlane/.env.example"), "A=\n")
	got, _ := runFastlaneEnv([]string{"--dir", dir})
	if res := got.(fastlaneEnvResult); res.EnvFile || !res.ExampleOnly {
		t.Errorf("unexpected: %+v", res)
	}
}

func TestPreflightRejectsPathLikeToolNames(t *testing.T) {
	if _, err := runPreflight([]string{"--tools", "../../bin/sh"}); err == nil {
		t.Fatal("tool names containing slashes must be rejected")
	}
	got, err := runPreflight([]string{"--tools", "definitely-not-a-real-tool-xyz"})
	if err != nil {
		t.Fatal(err)
	}
	if got.(preflightResult).Tools["definitely-not-a-real-tool-xyz"].Found {
		t.Error("unknown tool reported as found")
	}
}
