#!/usr/bin/env python3
"""Build and run an isolated Sidonia GRUB/QEMU visual test case."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import struct
import subprocess
import sys
import time
from typing import Any


HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
CASES_PATH = HERE / "cases.json"
TEMPLATE_PATH = HERE / "fixture" / "grub.cfg.template"
WORK = HERE / "work"
CAPTURES = HERE / "captures"
REPORTS = HERE / "reports"
LOGS = REPORTS / "logs"
COMPARISONS = REPORTS / "comparisons"

ISO_TIMEOUT = 120
STARTUP_TIMEOUT = 20
MENU_TIMEOUT = 45
SCREENSHOT_TIMEOUT = 15
SHUTDOWN_TIMEOUT = 10

PROFILE_DIMENSIONS = {
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "1440p": (2560, 1440),
}
THEMES = {"T1", "T2", "T3", "T4"}
FIRMWARES = {"bios", "uefi"}


class CaseFailure(RuntimeError):
    def __init__(
        self, case: dict[str, Any], step: str, reason: str, status: str = "FAIL",
    ) -> None:
        self.case = case
        self.step = step
        self.reason = reason
        self.status = status
        super().__init__(f"{case['id']}: {step}: {reason}")


class QMP:
    def __init__(self, reader: Any, writer: Any, timeout: float) -> None:
        self.deadline = time.monotonic() + timeout
        self.reader = reader
        self.writer = writer
        self.selector = selectors.DefaultSelector()
        self.selector.register(reader, selectors.EVENT_READ)
        self.buffer = b""
        greeting = self._read_message()
        if "QMP" not in greeting:
            raise RuntimeError(f"invalid QMP greeting: {greeting!r}")
        self.execute("qmp_capabilities")

    def _read_message(self) -> dict[str, Any]:
        while True:
            if b"\n" in self.buffer:
                line, self.buffer = self.buffer.split(b"\n", 1)
                if line.strip():
                    return json.loads(line)
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("timed out waiting for QMP response")
            if not self.selector.select(remaining):
                raise TimeoutError("timed out waiting for QMP response")
            chunk = os.read(self.reader.fileno(), 65536)
            if not chunk:
                raise ConnectionError("QMP stream closed")
            self.buffer += chunk

    def execute(
        self, command: str, arguments: dict[str, Any] | None = None,
        timeout: float = SCREENSHOT_TIMEOUT,
    ) -> Any:
        request_id = f"sidonia-{time.monotonic_ns()}"
        request: dict[str, Any] = {"execute": command, "id": request_id}
        if arguments:
            request["arguments"] = arguments
        self.writer.write(json.dumps(request).encode("utf-8") + b"\r\n")
        self.writer.flush()
        self.deadline = time.monotonic() + timeout
        while True:
            response = self._read_message()
            if response.get("id") != request_id:
                continue
            if "error" in response:
                raise RuntimeError(f"QMP {command} failed: {response['error']}")
            return response.get("return")

    def close(self) -> None:
        self.selector.close()


def fail(
    case: dict[str, Any], step: str, reason: str, status: str = "FAIL",
) -> None:
    raise CaseFailure(case, step, reason, status)


def path_in_repo(relative: str, case: dict[str, Any], field: str) -> Path:
    candidate = (REPO / relative).resolve()
    if not candidate.is_relative_to(REPO):
        fail(case, "manifest validation", f"{field} escapes repository: {relative}")
    return candidate


def load_cases() -> list[dict[str, Any]]:
    try:
        cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"cannot read {CASES_PATH}: {error}") from error
    if not isinstance(cases, list):
        raise RuntimeError("cases.json must contain a list")

    ids: set[str] = set()
    combinations: set[tuple[str, str, str]] = set()
    required = {
        "id", "theme", "profile", "width", "height", "firmware",
        "runtime_theme_dir", "pf2_path", "expected_font_name",
    }
    for case in cases:
        if not isinstance(case, dict) or set(case) != required:
            raise RuntimeError(f"manifest entry has unexpected fields: {case!r}")
        case_id = case["id"]
        if case_id in ids:
            fail(case, "manifest validation", f"duplicate case ID: {case_id}")
        ids.add(case_id)
        if case["theme"] not in THEMES:
            fail(case, "manifest validation", f"unknown theme: {case['theme']}")
        if case["profile"] not in PROFILE_DIMENSIONS:
            fail(case, "manifest validation", f"unknown profile: {case['profile']}")
        if case["firmware"] not in FIRMWARES:
            fail(case, "manifest validation", f"unknown firmware: {case['firmware']}")
        expected_dimensions = PROFILE_DIMENSIONS[case["profile"]]
        if (case["width"], case["height"]) != expected_dimensions:
            fail(case, "manifest validation", "profile dimensions are inconsistent")
        expected_id = f"{case['theme']}-{case['profile']}-{case['firmware']}"
        if case_id != expected_id:
            fail(case, "manifest validation", f"expected ID {expected_id}")
        combination = (case["theme"], case["profile"], case["firmware"])
        if combination in combinations:
            fail(case, "manifest validation", f"duplicate combination: {combination}")
        combinations.add(combination)

        theme_dir = path_in_repo(case["runtime_theme_dir"], case, "runtime_theme_dir")
        if not theme_dir.is_dir():
            fail(case, "manifest validation", f"missing theme directory: {theme_dir}")
        theme_file = theme_dir / "theme.txt"
        font_file = theme_dir / case["pf2_path"]
        if not theme_file.is_file():
            fail(case, "manifest validation", f"missing file: {theme_file}")
        if not font_file.is_file():
            fail(case, "manifest validation", f"missing file: {font_file}")
        theme_text = theme_file.read_text(encoding="utf-8")
        if case["expected_font_name"] not in theme_text:
            fail(case, "manifest validation", "expected font name absent from theme.txt")
        for asset in theme_dir.rglob("*"):
            if asset.is_symlink() and not asset.resolve().is_relative_to(theme_dir):
                fail(case, "manifest validation", f"asset symlink escapes theme: {asset}")

    expected_combinations = {
        (theme, profile, firmware)
        for theme in THEMES
        for profile in PROFILE_DIMENSIONS
        for firmware in FIRMWARES
    }
    if combinations != expected_combinations or len(cases) != 24:
        missing = sorted(expected_combinations - combinations)
        extra = sorted(combinations - expected_combinations)
        raise RuntimeError(f"manifest must declare 24 cases; missing={missing}, extra={extra}")
    return cases


def require_executable(name: str, case: dict[str, Any]) -> str:
    executable = shutil.which(name)
    if executable is None:
        fail(case, "prerequisite check", f"missing executable: {name}")
    return executable


def command_version(command: list[str]) -> str:
    result = subprocess.run(
        command, shell=False, check=True, capture_output=True, text=True, timeout=10,
    )
    output = result.stdout or result.stderr
    return output.splitlines()[0].strip()


def collect_versions(case: dict[str, Any], args: argparse.Namespace) -> dict[str, str]:
    versions: dict[str, str] = {}
    queries = {
        "qemu": ["qemu-system-x86_64", "--version"],
        "grub": ["grub-mkrescue", "--version"],
        "xorriso": ["xorriso", "-version"],
    }
    for name, query in queries.items():
        executable = shutil.which(query[0])
        if executable is None:
            versions[name] = "unavailable"
            continue
        try:
            versions[name] = command_version([executable, *query[1:]])
        except (OSError, subprocess.SubprocessError):
            versions[name] = "version unavailable"
    if case["firmware"] == "bios":
        versions["ovmf"] = "not used"
    else:
        pacman = shutil.which("pacman")
        if pacman is not None:
            try:
                versions["ovmf"] = command_version([pacman, "-Q", "edk2-ovmf"])
            except (OSError, subprocess.SubprocessError):
                versions["ovmf"] = str(args.ovmf_code or "unavailable")
        else:
            versions["ovmf"] = str(args.ovmf_code or "unavailable")
    return versions


def validate_prerequisites(case: dict[str, Any], args: argparse.Namespace) -> dict[str, str]:
    require_executable("qemu-system-x86_64", case)
    require_executable("grub-mkrescue", case)
    require_executable("xorriso", case)
    if shutil.which("mformat") is None:
        fail(
            case,
            "prerequisite check",
            "missing executable mformat (provided by the mtools package); "
            "grub-mkrescue cannot create BIOS+UEFI rescue media",
        )
    bios_modules = Path("/usr/lib/grub/i386-pc")
    uefi_modules = Path("/usr/lib/grub/x86_64-efi")
    if not (bios_modules / "cdboot.img").is_file():
        fail(case, "prerequisite check", "missing GRUB BIOS CD modules")
    if not (uefi_modules / "normal.mod").is_file():
        fail(case, "prerequisite check", "missing GRUB x86_64 UEFI modules")
    if case["firmware"] == "uefi":
        if args.ovmf_code is None or args.ovmf_vars is None:
            fail(case, "prerequisite check", "UEFI requires --ovmf-code and --ovmf-vars")
        for label, firmware_path in (
            ("OVMF code", args.ovmf_code), ("OVMF variables", args.ovmf_vars),
        ):
            if not firmware_path.is_file():
                fail(case, "prerequisite check", f"missing {label}: {firmware_path}")
        if os.access(args.ovmf_code, os.W_OK):
            # The QEMU argument still opens this image read-only. Record a clear invariant.
            pass
    return collect_versions(case, args)


def render_config(case: dict[str, Any], timeout_fixture: bool = False) -> str:
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    rendered = (
        template.replace("{{MODE}}", f"{case['width']}x{case['height']}")
        .replace("{{PF2_PATH}}", case["pf2_path"])
    )
    if timeout_fixture:
        rendered = rendered.replace("set timeout=-1", "set timeout=8")
    return rendered


def iso_signature(case: dict[str, Any], timeout_fixture: bool) -> str:
    digest = hashlib.sha256()
    digest.update(render_config(case, timeout_fixture).encode("utf-8"))
    theme_dir = REPO / case["runtime_theme_dir"]
    for asset in sorted(path for path in theme_dir.rglob("*") if path.is_file()):
        digest.update(str(asset.relative_to(theme_dir)).encode("utf-8"))
        digest.update(asset.read_bytes())
    return digest.hexdigest()


def build_iso(
    case: dict[str, Any], case_work: Path, timeout_fixture: bool = False,
) -> tuple[Path, Path]:
    iso_dir = WORK / "isos"
    iso_dir.mkdir(parents=True, exist_ok=True)
    suffix = "-timeout" if timeout_fixture else ""
    iso_stem = f"{case['theme']}-{case['profile']}{suffix}"
    iso_path = iso_dir / f"{iso_stem}.iso"
    signature_path = iso_dir / f"{iso_stem}.sha256"
    build_log = LOGS / f"{iso_stem}-iso-build.log"
    signature = iso_signature(case, timeout_fixture)
    if (
        iso_path.is_file()
        and iso_path.stat().st_size > 0
        and signature_path.is_file()
        and signature_path.read_text(encoding="ascii").strip() == signature
    ):
        return iso_path, build_log
    fixture_root = case_work / "iso-root"
    grub_dir = fixture_root / "boot" / "grub"
    runtime_dir = grub_dir / "themes" / "Sidonia"
    grub_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(REPO / case["runtime_theme_dir"], runtime_dir)
    (grub_dir / "grub.cfg").write_text(
        render_config(case, timeout_fixture), encoding="utf-8",
    )

    command = [require_executable("grub-mkrescue", case), "-o", str(iso_path), str(fixture_root)]
    try:
        result = subprocess.run(
            command, shell=False, capture_output=True, text=True, timeout=ISO_TIMEOUT,
        )
    except subprocess.TimeoutExpired as error:
        build_log.write_text(str(error), encoding="utf-8")
        fail(case, "ISO creation", f"timed out after {ISO_TIMEOUT}s")
    build_log.write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode != 0:
        fail(case, "ISO creation", f"grub-mkrescue exited {result.returncode}; see {build_log}")
    if not iso_path.is_file() or iso_path.stat().st_size == 0:
        fail(case, "ISO creation", "grub-mkrescue produced no ISO")
    signature_path.write_text(signature + "\n", encoding="ascii")
    return iso_path, build_log


def wait_for_marker(
    case: dict[str, Any], serial_log: Path, marker: str, timeout: float, step: str,
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if serial_log.exists():
            content = serial_log.read_bytes()
            if marker.encode("ascii") in content:
                return
        time.sleep(0.1)
    fail(case, step, f"timed out after {timeout}s waiting for {marker}")


def wait_for_menu(case: dict[str, Any], serial_log: Path) -> None:
    marker = b"SIDONIA_MENU_READY"
    final_label = b"04  UEFI FIRMWARE"
    deadline = time.monotonic() + MENU_TIMEOUT
    while time.monotonic() < deadline:
        if serial_log.exists():
            content = serial_log.read_bytes()
            marker_offset = content.find(marker)
            if marker_offset >= 0:
                menu_output = content[marker_offset + len(marker):]
                if b"error:" in menu_output:
                    fail(
                        case,
                        "menu readiness",
                        f"GRUB reported a theme error; see {serial_log}",
                    )
                if final_label in menu_output:
                    time.sleep(0.5)
                    return
        time.sleep(0.1)
    fail(
        case,
        "menu readiness",
        f"timed out after {MENU_TIMEOUT}s waiting for the complete fixture menu",
    )


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as image:
        header = image.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError("capture is not a valid PNG")
    return struct.unpack(">II", header[16:24])


def capture(
    case: dict[str, Any], qmp: QMP, path: Path, state: str,
) -> tuple[int, int]:
    try:
        qmp.execute("screendump", {"filename": str(path), "format": "png"})
    except (OSError, RuntimeError, TimeoutError) as error:
        fail(case, f"screenshot {state}", str(error))
    if not path.is_file():
        fail(case, f"screenshot {state}", f"capture was not created: {path}")
    try:
        dimensions = png_dimensions(path)
    except (OSError, ValueError) as error:
        fail(case, f"screenshot {state}", str(error))
    expected = (case["width"], case["height"])
    if dimensions != expected:
        fail(
            case,
            f"screenshot {state}",
            f"MODE_UNAVAILABLE: expected {expected}, got {dimensions}",
            "BLOCKED",
        )
    return dimensions


def stop_qemu(process: subprocess.Popen[bytes], qmp: QMP | None) -> None:
    if process.poll() is not None:
        return
    if qmp is not None:
        try:
            qmp.execute("quit", timeout=SHUTDOWN_TIMEOUT)
        except (OSError, RuntimeError, TimeoutError):
            pass
    try:
        process.wait(timeout=SHUTDOWN_TIMEOUT)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


def qemu_command(
    case: dict[str, Any], args: argparse.Namespace, case_work: Path,
    iso_path: Path, serial_log: Path,
) -> list[str]:
    command = [
        require_executable("qemu-system-x86_64", case),
        "-machine", "q35",
        "-accel", "tcg",
        "-m", "256",
        "-device", "VGA,vgamem_mb=64",
        "-nic", "none",
        "-boot", "d",
        "-cdrom", str(iso_path),
        "-display", "none",
        "-qmp", "stdio",
        "-serial", f"file:{serial_log}",
        "-no-reboot",
    ]
    if case["firmware"] == "uefi":
        variables_copy = case_work / "OVMF_VARS.fd"
        shutil.copy2(args.ovmf_vars, variables_copy)
        command.extend([
            "-drive", f"if=pflash,format=raw,readonly=on,file={args.ovmf_code}",
            "-drive", f"if=pflash,format=raw,file={variables_copy}",
        ])
    return command


def requires_all_rows(case: dict[str, Any]) -> bool:
    return case["theme"] == "T4" or (
        case["theme"] in {"T1", "T2", "T3"}
        and case["profile"] == "1080p"
        and case["firmware"] == "uefi"
    )


def run_case(case: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    versions = validate_prerequisites(case, args)
    case_work = WORK / case["id"]
    if case_work.exists():
        shutil.rmtree(case_work)
    case_work.mkdir(parents=True)
    CAPTURES.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    serial_log = LOGS / f"{case['id']}.log"
    if serial_log.exists():
        serial_log.unlink()

    iso_path, build_log = build_iso(case, case_work)
    stderr_log = case_work / "qemu-stderr.log"
    command = qemu_command(case, args, case_work, iso_path, serial_log)

    stderr_handle = stderr_log.open("wb")
    process: subprocess.Popen[bytes] | None = None
    qmp: QMP | None = None
    capture_paths = {
        row: CAPTURES / f"{case['id']}-row{row}.png" for row in range(1, 5)
    }
    dimensions: dict[int, tuple[int, int]] = {}
    captured_rows = {1, 2, 3, 4} if requires_all_rows(case) else {1, 4}
    try:
        process = subprocess.Popen(
            command,
            shell=False,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=stderr_handle,
        )
        try:
            qmp = QMP(process.stdout, process.stdin, STARTUP_TIMEOUT)
        except (OSError, RuntimeError, TimeoutError) as error:
            fail(case, "QEMU startup", str(error))
        if process.poll() is not None:
            fail(case, "QEMU startup", f"QEMU exited {process.returncode}; see {stderr_log}")

        wait_for_menu(case, serial_log)
        for row in range(1, 5):
            if row in captured_rows:
                dimensions[row] = capture(
                    case, qmp, capture_paths[row], f"row{row}",
                )
            if row == 4:
                break
            qmp.execute("send-key", {"keys": [{"type": "qcode", "data": "down"}]})
            time.sleep(0.35)
        qmp.execute("send-key", {"keys": [{"type": "qcode", "data": "ret"}]})
        wait_for_marker(case, serial_log, "SIDONIA_ENTRY_04", 10, "entry activation")
        qmp.execute("quit", timeout=SHUTDOWN_TIMEOUT)
        try:
            process.wait(timeout=SHUTDOWN_TIMEOUT)
        except subprocess.TimeoutExpired:
            fail(case, "QEMU shutdown", f"timed out after {SHUTDOWN_TIMEOUT}s")
        if process.returncode != 0:
            fail(case, "QEMU shutdown", f"QEMU exited {process.returncode}")
    finally:
        if process is not None:
            stop_qemu(process, qmp)
        if qmp is not None:
            qmp.close()
        stderr_handle.close()

    serial_content = serial_log.read_bytes().lower()
    if b"error:" in serial_content or b"warning:" in serial_content:
        fail(case, "serial validation", f"GRUB reported an error or warning; see {serial_log}")
    result_captures = {
        f"row{row}": str(capture_paths[row]) for row in sorted(captured_rows)
    }
    result = {
        "id": case["id"],
        "theme": case["theme"],
        "profile": case["profile"],
        "firmware": case["firmware"],
        "requested_mode": f"{case['width']}x{case['height']}x32",
        "status": "PASS",
        "versions": versions,
        "captures": result_captures,
        "serial_log": str(serial_log),
        "screenshot_width": dimensions[1][0],
        "screenshot_height": dimensions[1][1],
        "row4_width": dimensions[4][0],
        "row4_height": dimensions[4][1],
        "failed_step": None,
        "reason": None,
        "iso_build_log": str(build_log),
    }
    return result


def run_timeout_case(
    case: dict[str, Any], args: argparse.Namespace,
) -> dict[str, Any]:
    validate_prerequisites(case, args)
    case_work = WORK / f"{case['id']}-timeout"
    if case_work.exists():
        shutil.rmtree(case_work)
    case_work.mkdir(parents=True)
    CAPTURES.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    serial_log = LOGS / f"{case['id']}-timeout.log"
    if serial_log.exists():
        serial_log.unlink()

    iso_path, build_log = build_iso(case, case_work, timeout_fixture=True)
    stderr_log = case_work / "qemu-stderr.log"
    capture_path = CAPTURES / f"{case['id']}-timeout.png"
    command = qemu_command(case, args, case_work, iso_path, serial_log)
    stderr_handle = stderr_log.open("wb")
    process: subprocess.Popen[bytes] | None = None
    qmp: QMP | None = None
    try:
        process = subprocess.Popen(
            command,
            shell=False,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=stderr_handle,
        )
        try:
            qmp = QMP(process.stdout, process.stdin, STARTUP_TIMEOUT)
        except (OSError, RuntimeError, TimeoutError) as error:
            fail(case, "timeout QEMU startup", str(error))
        if process.poll() is not None:
            fail(
                case,
                "timeout QEMU startup",
                f"QEMU exited {process.returncode}; see {stderr_log}",
            )
        wait_for_menu(case, serial_log)
        time.sleep(3)
        dimensions = capture(case, qmp, capture_path, "timeout")
        qmp.execute("quit", timeout=SHUTDOWN_TIMEOUT)
        try:
            process.wait(timeout=SHUTDOWN_TIMEOUT)
        except subprocess.TimeoutExpired:
            fail(case, "timeout QEMU shutdown", f"timed out after {SHUTDOWN_TIMEOUT}s")
        if process.returncode != 0:
            fail(case, "timeout QEMU shutdown", f"QEMU exited {process.returncode}")
    finally:
        if process is not None:
            stop_qemu(process, qmp)
        if qmp is not None:
            qmp.close()
        stderr_handle.close()

    serial_content = serial_log.read_bytes().lower()
    if b"error:" in serial_content or b"warning:" in serial_content:
        fail(
            case,
            "timeout serial validation",
            f"GRUB reported an error or warning; see {serial_log}",
        )
    return {
        "capture": str(capture_path),
        "width": dimensions[0],
        "height": dimensions[1],
        "serial_log": str(serial_log),
        "iso_build_log": str(build_log),
    }


def write_reports(results: list[dict[str, Any]]) -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    results_path = REPORTS / "results.json"
    results_path.write_text(json.dumps({"cases": results}, indent=2) + "\n", encoding="utf-8")
    passed = sum(result["status"] == "PASS" for result in results)
    failed = sum(result["status"] == "FAIL" for result in results)
    blocked = sum(result["status"] == "BLOCKED" for result in results)
    lines = [
        "# Sidonia GRUB/QEMU visual test results",
        "",
        "| Case | Requested mode | Status | Captures | Comparisons | Reason |",
        "|---|---|---|---|---|---|",
    ]
    for result in results:
        captures = result.get("captures", {})
        capture_text = ", ".join(f"[{name}]({path})" for name, path in captures.items())
        comparisons = result.get("comparisons", {})
        comparison_text = ", ".join(
            f"[{name} side-by-side]({paths['side_by_side']}) / "
            f"[difference]({paths['difference']})"
            for name, paths in comparisons.items()
        )
        reason = result.get("reason") or ""
        lines.append(
            f"| {result['id']} | {result['requested_mode']} | {result['status']} "
            f"| {capture_text} | {comparison_text} | {reason} |"
        )
    lines.extend([
        "",
        f"Passed: {passed}/{len(results)}",
        f"Failed: {failed}/{len(results)}",
        f"Blocked: {blocked}/{len(results)}",
        "",
    ])
    (REPORTS / "results.md").write_text("\n".join(lines), encoding="utf-8")


def comparison_reference(case: dict[str, Any]) -> Path:
    if case["profile"] == "1080p":
        preview = REPO / "previews" / f"{case['theme']}.png"
        if preview.is_file():
            return preview
    resampled = (
        REPO / "build" / case["theme"].lower()
        / case["profile"] / "reference-resample.png"
    )
    if resampled.is_file():
        return resampled
    background = REPO / case["runtime_theme_dir"] / "background.png"
    if background.is_file():
        return background
    raise RuntimeError(f"no comparison reference for {case['id']}")


def run_comparison_command(command: list[str], output: Path) -> None:
    try:
        result = subprocess.run(
            command,
            shell=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f"comparison failed for {output}: {error}") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(
            f"comparison failed for {output}: exit {result.returncode}: {detail}"
        )
    if not output.is_file():
        raise RuntimeError(f"comparison did not create {output}")


def create_comparisons(
    results: list[dict[str, Any]], cases: list[dict[str, Any]],
) -> None:
    magick = shutil.which("magick")
    if magick is None:
        raise RuntimeError("comparison generation requires ImageMagick (magick)")
    case_map = {case["id"]: case for case in cases}
    COMPARISONS.mkdir(parents=True, exist_ok=True)
    for result in results:
        case = case_map[result["id"]]
        reference = comparison_reference(case)
        reference_dimensions = png_dimensions(reference)
        comparison_records: dict[str, dict[str, str]] = {}
        for state, capture_value in result.get("captures", {}).items():
            capture_path = Path(capture_value)
            if not capture_path.is_file():
                raise RuntimeError(f"missing capture for comparison: {capture_path}")
            if png_dimensions(capture_path) != reference_dimensions:
                raise RuntimeError(
                    f"comparison dimensions differ for {capture_path} and {reference}"
                )
            side_by_side = COMPARISONS / f"{capture_path.stem}-side-by-side.png"
            difference = COMPARISONS / f"{capture_path.stem}-difference.png"
            run_comparison_command(
                [magick, str(capture_path), str(reference), "+append", str(side_by_side)],
                side_by_side,
            )
            run_comparison_command(
                [
                    magick,
                    str(capture_path),
                    str(reference),
                    "-compose", "difference",
                    "-composite",
                    str(difference),
                ],
                difference,
            )
            comparison_records[state] = {
                "reference": str(reference),
                "side_by_side": str(side_by_side),
                "difference": str(difference),
            }
        result["comparisons"] = comparison_records
        result["visual_status"] = "PASS"


def read_existing_results() -> dict[str, dict[str, Any]]:
    results_path = REPORTS / "results.json"
    if not results_path.is_file():
        return {}
    try:
        document = json.loads(results_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    records = document.get("cases", []) if isinstance(document, dict) else []
    if not isinstance(records, list):
        return {}
    return {
        record["id"]: record
        for record in records
        if isinstance(record, dict) and isinstance(record.get("id"), str)
    }


def failure_result(
    case: dict[str, Any], error: CaseFailure, args: argparse.Namespace,
) -> dict[str, Any]:
    status = "BLOCKED" if error.step == "prerequisite check" else error.status
    captures: dict[str, str] = {}
    dimensions: tuple[int, int] | None = None
    for row in range(1, 5):
        capture_path = CAPTURES / f"{case['id']}-row{row}.png"
        if not capture_path.is_file():
            continue
        try:
            capture_dimensions = png_dimensions(capture_path)
        except (OSError, ValueError):
            continue
        captures[f"row{row}"] = str(capture_path)
        if row == 1:
            dimensions = capture_dimensions
    return {
        "id": case["id"],
        "theme": case["theme"],
        "profile": case["profile"],
        "firmware": case["firmware"],
        "requested_mode": f"{case['width']}x{case['height']}x32",
        "status": status,
        "versions": collect_versions(case, args),
        "captures": captures,
        "serial_log": str(LOGS / f"{case['id']}.log"),
        "screenshot_width": None if dimensions is None else dimensions[0],
        "screenshot_height": None if dimensions is None else dimensions[1],
        "failed_step": error.step,
        "reason": error.reason,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--case", help="exact case ID from cases.json")
    selection.add_argument("--theme", choices=sorted(THEMES), help="run six cases for one theme")
    selection.add_argument("--all", action="store_true", help="run all 24 selector cases")
    postprocessing = parser.add_mutually_exclusive_group()
    postprocessing.add_argument(
        "--timeouts-only",
        action="store_true",
        help="run only 1080p/UEFI timeout fixtures for the selection",
    )
    postprocessing.add_argument(
        "--comparisons-only",
        action="store_true",
        help="generate visual comparisons from existing passing captures",
    )
    parser.add_argument("--ovmf-code", type=Path, help="explicit read-only OVMF code image")
    parser.add_argument("--ovmf-vars", type=Path, help="explicit OVMF variables template")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        cases = load_cases()
    except (CaseFailure, RuntimeError) as error:
        print(error, file=sys.stderr)
        return 2
    if args.case is not None:
        selected_cases = [case for case in cases if case["id"] == args.case]
        if not selected_cases:
            print(f"unknown case ID: {args.case}", file=sys.stderr)
            return 2
    elif args.theme is not None:
        selected_cases = [case for case in cases if case["theme"] == args.theme]
    else:
        selected_cases = list(cases)
    if args.timeouts_only:
        selected_cases = [
            case for case in selected_cases
            if case["profile"] == "1080p" and case["firmware"] == "uefi"
        ]
        if not selected_cases:
            print("timeout fixtures require a 1080p/UEFI case selection", file=sys.stderr)
            return 2

    valid_ids = {case["id"] for case in cases}
    result_map = {
        case_id: record
        for case_id, record in read_existing_results().items()
        if case_id in valid_ids
    }
    if args.comparisons_only:
        missing = [
            case["id"] for case in selected_cases
            if result_map.get(case["id"], {}).get("status") != "PASS"
        ]
        if missing:
            print(
                "comparisons require passing selector results: " + ", ".join(missing),
                file=sys.stderr,
            )
            return 2
        selected_results = [result_map[case["id"]] for case in selected_cases]
        try:
            create_comparisons(selected_results, cases)
        except RuntimeError as error:
            print(error, file=sys.stderr)
            return 2
        ordered_results = [
            result_map[case["id"]] for case in cases if case["id"] in result_map
        ]
        write_reports(ordered_results)
        print(f"Created comparisons for {len(selected_results)} passing cases")
        return 0

    exit_code = 0
    for selected in selected_cases:
        if args.timeouts_only:
            existing = result_map.get(selected["id"])
            if existing is None or existing.get("status") != "PASS":
                print(
                    f"{selected['id']}: timeout skipped until selector case passes",
                    file=sys.stderr,
                )
                exit_code = 1
                continue
            try:
                timeout_result = run_timeout_case(selected, args)
            except CaseFailure as error:
                existing["status"] = error.status
                existing["timeout_status"] = error.status
                existing["failed_step"] = error.step
                existing["reason"] = error.reason
                print(error, file=sys.stderr)
                exit_code = 1
            else:
                existing.setdefault("captures", {})["timeout"] = timeout_result["capture"]
                existing["timeout_status"] = "PASS"
                existing["timeout_width"] = timeout_result["width"]
                existing["timeout_height"] = timeout_result["height"]
                existing["timeout_serial_log"] = timeout_result["serial_log"]
                print(f"{selected['id']}-timeout: PASS")
                case_work = WORK / f"{selected['id']}-timeout"
                if case_work.exists():
                    shutil.rmtree(case_work)
        else:
            try:
                result = run_case(selected, args)
            except CaseFailure as error:
                result = failure_result(selected, error, args)
                print(error, file=sys.stderr)
                exit_code = 1
            result_map[selected["id"]] = result
            if result["status"] == "PASS":
                print(f"{selected['id']}: PASS")
                case_work = WORK / selected["id"]
                ordered_results = [
                    result_map[case["id"]] for case in cases if case["id"] in result_map
                ]
                write_reports(ordered_results)
                if case_work.exists():
                    shutil.rmtree(case_work)
            else:
                print(f"{selected['id']}: {result['status']}", file=sys.stderr)

        ordered_results = [
            result_map[case["id"]] for case in cases if case["id"] in result_map
        ]
        write_reports(ordered_results)
        if not args.timeouts_only and result_map[selected["id"]]["status"] == "FAIL":
            break

    for theme in sorted({case["theme"] for case in selected_cases}):
        theme_cases = [case for case in selected_cases if case["theme"] == theme]
        complete = sum(case["id"] in result_map for case in theme_cases)
        passed = sum(
            result_map.get(case["id"], {}).get("status") == "PASS"
            for case in theme_cases
        )
        blocked = sum(
            result_map.get(case["id"], {}).get("status") == "BLOCKED"
            for case in theme_cases
        )
        print(f"{theme}: {complete}/{len(theme_cases)} tested; {passed} pass, {blocked} blocked")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
