#!/usr/bin/env python3
"""
run_benchmark.py — DSH Computer Use Phase 0 Baseline Benchmark runner

对 benchmarks/tasks.json 中的每个任务，用 helper 传输层（bin/cu-helper）
确定性执行动作序列并验证结果，记录性能指标。

指标：task, success, wall_time, steps, llm_calls, vision_calls, screenshots,
      tool_calls, input_tokens, output_tokens, retries, error

LLM 相关字段（llm_calls/input_tokens/output_tokens）在 helper 传输层基准中为 0；
agent-driven 基准在 Phase 1（模型路由）后补充。

用法：
  python3 run_benchmark.py [--tasks tasks.json] [--output benchmark_baseline.json]
  python3 run_benchmark.py --list          # 列出任务
  python3 run_benchmark.py --only open_*   # 只跑匹配的任务（逗号分隔或前缀）

安全：只打开无害应用、操作 /tmp/dsh-cu-bench-* 临时文件，测试后全部清理；
不读取/修改用户数据、不触碰系统剪贴板。
"""
import csv
import json
import os
import subprocess
import sys
import time
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
HELPER = PLUGIN_ROOT / "bin" / "cu-helper"
DEFAULT_TASKS = Path(__file__).resolve().parent / "tasks.json"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "benchmark_baseline.json"

HELPER_TIMEOUT = 30
SYS_TIMEOUT = 20

# 应用名 → 进程名（pkill 用）
PROCESS_NAMES = {
    "Terminal": "Terminal",
    "TextEdit": "TextEdit",
    "Finder": "Finder",
    "Calculator": "Calculator",
    "Visual Studio Code": "Code",
    "Safari": "Safari",
    "Notes": "Notes",
    "System Settings": "System Settings",
    "Music": "Music",
}


class BenchError(Exception):
    """任务执行失败（含原因）。"""

    def __init__(self, reason, code=""):
        super().__init__(reason)
        self.reason = reason
        self.code = code


# ---------------------------------------------------------------------------
# helper / 系统调用封装
# ---------------------------------------------------------------------------

def helper(command, args=None, timeout=HELPER_TIMEOUT):
    """调用 helper，返回解析后的 JSON。失败抛 BenchError。"""
    payload = json.dumps(args or {})
    try:
        proc = subprocess.run(
            [str(HELPER), command],
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise BenchError(f"helper {command} 超时", "timeout")
    if proc.returncode != 0:
        raise BenchError(f"helper {command} 非零退出: {proc.stderr[:200]}", "helper_exit")
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise BenchError(f"helper {command} 输出无法解析: {proc.stdout[:200]}", "protocol")
    if isinstance(data, dict) and data.get("error"):
        err = data["error"]
        raise BenchError(err.get("message", "helper 错误"), err.get("code", "unknown"))
    return data


def run_sys(cmd, timeout=SYS_TIMEOUT):
    """运行系统命令，返回 (returncode, stdout, stderr)。"""
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"
    except FileNotFoundError:
        return -2, "", "not_found"


def app_pid(name):
    """通过 helper apps 按名称匹配应用 pid（模糊 contains，支持候选名）。"""
    data = helper("apps")
    candidates = [name, PROCESS_NAMES.get(name, name)]
    targets = [c.lower() for c in candidates if c]
    for app in data.get("apps", []):
        appname = (app.get("name") or "").lower()
        for t in targets:
            if t in appname:
                return app.get("pid")
    return None


def app_exists(name):
    """应用是否已安装（/Applications 或 /System/Applications）。"""
    code, _, _ = run_sys(["open", "-g", "-Ra", name])
    return code == 0


# ---------------------------------------------------------------------------
# 观察辅助
# ---------------------------------------------------------------------------

def observe(pid, ax_index=None):
    args = {"pid": pid, "maxNodes": 1500, "maxDepth": 40}
    if ax_index is not None:
        args["axIndex"] = ax_index
    return helper("observe", args)


def find_elements(pid, role=None, title=None, value=None, ax_index=None):
    """在 app 的树中查找元素（支持 role/title/value/axIndex 过滤），返回元素列表。"""
    data = observe(pid, ax_index=ax_index)
    out = []
    for el in data.get("elements", []):
        if role and el.get("role") != role:
            continue
        if title and title not in (el.get("title") or ""):
            continue
        if value and value not in (el.get("value") or ""):
            continue
        out.append(el)
    return out


def windows_of(pid):
    data = observe(pid)
    return data.get("windows", [])


# ---------------------------------------------------------------------------
# 动作执行器
# ---------------------------------------------------------------------------

class Runner:
    def __init__(self, ctx):
        self.ctx = ctx  # 任务上下文：{vars: {}, steps, tool_calls, screenshots}

    def exec(self, action):
        """执行单个动作。返回 True=动作级成功，False=动作失败（任务失败）。"""
        kind = action.get("type")
        fn = getattr(self, f"act_{kind}", None)
        if fn is None:
            raise BenchError(f"未知动作类型: {kind}", "bad_action")
        return fn(action)

    # ---- 基础 ----
    def act_open_app(self, a):
        target = a["target"]
        # 记录是否已在运行（决定清理策略：不杀用户已有实例）
        self.ctx["vars"]["was_running"] = app_pid(target) is not None
        code, _, err = run_sys(["open", "-g", "-a", target])
        if code != 0:
            raise BenchError(f"打开 {target} 失败: {err[:120]}", "open_failed")
        # 等待进程出现并取 pid
        deadline = time.time() + 10
        pid = None
        while time.time() < deadline:
            pid = app_pid(target)
            if pid:
                break
            time.sleep(0.3)
        if pid is None:
            raise BenchError(f"应用 {target} 未启动", "app_not_started")
        self.ctx["vars"]["app_pid"] = pid
        return True

    def act_wait(self, a):
        time.sleep(a.get("ms", 500) / 1000.0)
        return True

    def act_activate_app(self, a):
        code, _, _ = run_sys(["open", "-a", a["target"]])
        return code == 0

    def act_quit_app(self, a):
        """退出应用。安全规则：
        1. Terminal 永不 quit（可能运行用户会话，如 Jupyter Lab）；
        2. 应用在 benchmark 前已在运行（用户实例）时不 quit，只关测试窗口；
        3. 否则 osascript quit（超时保护），不 pkill（避免误伤）。"""
        name = a["app"]
        if name == "Terminal":
            return True  # 保护用户 Terminal 会话
        if self.ctx["vars"].get("was_running"):
            return True  # 用户已有实例，不退出
        run_sys(["osascript", "-e", f'tell application "{name}" to quit'], timeout=6)
        time.sleep(0.4)
        return True

    def act_write_tmp_file(self, a):
        Path(a["path"]).write_text(a.get("content", ""))
        return True

    def act_rm_file(self, a):
        try:
            os.remove(a["path"])
        except FileNotFoundError:
            pass
        return True

    def act_open_file_app(self, a):
        code, _, err = run_sys(["open", "-g", "-a", a["app"], a["path"]])
        if code != 0:
            raise BenchError(f"打开文件失败: {err[:120]}", "open_failed")
        deadline = time.time() + 8
        pid = None
        while time.time() < deadline:
            pid = app_pid(a["app"])
            if pid:
                break
            time.sleep(0.3)
        if pid is None:
            raise BenchError(f"应用 {a['app']} 未启动", "app_not_started")
        self.ctx["vars"]["app_pid"] = pid
        return True

    def act_open_url(self, a):
        code, _, err = run_sys(["open", "-g", "-a", a["app"], a["url"]])
        if code != 0:
            raise BenchError(f"打开网页失败: {err[:120]}", "open_failed")
        return True

    # ---- helper 动作 ----
    def _helper(self, command, args):
        self.ctx["tool_calls"] += 1
        return helper(command, args)

    def act_helper_set_value(self, a):
        pid = self.ctx["vars"].get(a.get("pid_var", "app_pid"))
        path = self.ctx["vars"].get(a["path_var"])
        self._helper("set-value", {"pid": pid, "path": path, "value": a["value"]})
        return True

    def act_helper_press_key(self, a):
        pid = self.ctx["vars"].get(a.get("pid_var", "app_pid"))
        args = {"pid": pid, "key": a["key"], "activate": a.get("activate", True)}
        if a.get("modifiers"):
            args["modifiers"] = a["modifiers"]
        self._helper("press-key", args)
        return True

    def act_helper_perform_action(self, a):
        pid = self.ctx["vars"].get(a.get("pid_var", "app_pid"))
        path = self.ctx["vars"].get(a["path_var"])
        self._helper("perform-action", {"pid": pid, "path": path, "action": a["action"]})
        return True

    def act_helper_type_text(self, a):
        pid = self.ctx["vars"].get(a.get("pid_var", "app_pid"))
        args = {"pid": pid, "text": a["text"], "activate": a.get("activate", True)}
        if a.get("path_var"):
            args["path"] = self.ctx["vars"].get(a["path_var"])
        self._helper("type-text", args)
        return True

    def act_helper_click(self, a):
        pid = self.ctx["vars"].get(a.get("pid_var", "app_pid"))
        path = self.ctx["vars"].get(a["path_var"])
        self._helper("click", {"pid": pid, "path": path, "prefer": a.get("prefer", "semantic"),
                               "activate": a.get("activate", False)})
        return True

    def act_new_window(self, a):
        """Cmd+N 新建窗口/文档（保证操作对象是干净的新窗口）。"""
        pid = self.ctx["vars"].get("app_pid")
        self._helper("press-key", {"pid": pid, "key": "n", "modifiers": ["command"], "activate": True})
        time.sleep(0.9)
        return True

    def act_dismiss_review_dialog(self, a):
        """Terminal 等应用的「Review Windows」对话框：点击 Cancel（不杀用户进程）。"""
        pid = self.ctx["vars"].get("app_pid")
        try:
            els = find_elements(pid, role="AXButton", title="Cancel")
        except BenchError:
            return True
        if els:
            self._helper("click", {"pid": pid, "path": els[0]["path"]})
            time.sleep(0.8)
        return True

    def act_dismiss_dialogs(self, a):
        """通用：遍历所有无标题窗口（对话框），点击其中的 Cancel 按钮。
        模态对话框（如 TextEdit Review Changes / Terminal Review Windows）会拦截
        菜单快捷键，必须先解除。只操作无标题窗口，跳过文档窗口，避免误点。"""
        pid = self.ctx["vars"].get("app_pid")
        data = helper("observe", {"pid": pid})
        for w in data.get("windows", []):
            if w.get("title"):
                continue  # 有标题的视为文档窗口，跳过
            idx = w.get("axIndex")
            try:
                els = find_elements(pid, role="AXButton", title="Cancel", ax_index=idx)
            except BenchError:
                continue
            for el in els:
                try:
                    self._helper("click", {"pid": pid, "axIndex": idx, "path": el["path"]})
                    time.sleep(0.6)
                    break
                except BenchError:
                    continue
        return True

    def act_helper_scroll(self, a):
        pid = self.ctx["vars"].get(a.get("pid_var", "app_pid"))
        args = {"pid": pid, "direction": a["direction"], "amount": a.get("amount", 3)}
        self._helper("scroll", args)
        return True

    def act_helper_observe(self, a):
        pid = self.ctx["vars"].get(a.get("pid_var", "app_pid"))
        self.ctx["vars"][a["var"]] = observe(pid)
        return True

    # ---- 观察 / 验证 ----
    def act_find_element(self, a):
        pid = self.ctx["vars"].get("app_pid")
        els = find_elements(pid, role=a["role"])
        if not els:
            raise BenchError(f"未找到 {a['role']}", "element_not_found")
        self.ctx["vars"][a["var"]] = els[0]["path"]
        return True

    def act_find_field(self, a):
        """按 value 包含文本查找 AXTextField（保存对话框文件名框），存 path 到 var。"""
        pid = self.ctx["vars"].get("app_pid")
        els = find_elements(pid, role=a["role"], value=a["value"])
        if not els:
            raise BenchError(f"未找到 {a['role']} 含 {a['value']}", "field_not_found")
        self.ctx["vars"][a["var"]] = els[0]["path"]
        return True

    def act_assert_field_value(self, a):
        pid = self.ctx["vars"].get("app_pid")
        path = self.ctx["vars"].get(a["var_field"])
        data = observe(pid)
        ok = False
        for el in data.get("elements", []):
            if el.get("path") == path and a["text"] in (el.get("value") or ""):
                ok = True
                break
        return self._assert(ok, f"字段 {path} 值不含 {a['text']}")

    def act_find_button(self, a):
        pid = self.ctx["vars"].get("app_pid")
        els = find_elements(pid, role="AXButton", title=a["title"])
        if not els:
            raise BenchError(f"未找到按钮 {a['title']}", "button_not_found")
        self.ctx["vars"][a["var"]] = els[0]["path"]
        return True

    def act_find_button_in_window(self, a):
        """在指定标题的窗口（对话框）内找按钮，避免多窗口树截断。"""
        pid = self.ctx["vars"].get("app_pid")
        data = helper("observe", {"pid": pid})
        idx = None
        for w in data.get("windows", []):
            if a["window_text"] in (w.get("title") or ""):
                idx = w.get("axIndex")
                break
        if idx is None:
            raise BenchError(f"未找到窗口含 {a['window_text']}", "window_not_found")
        els = find_elements(pid, role="AXButton", title=a["title"], ax_index=idx)
        if not els:
            raise BenchError(f"窗口含 {a['window_text']} 中未找到按钮 {a['title']}", "button_not_found")
        self.ctx["vars"][a["var"]] = els[0]["path"]
        return True

    def act_count_windows(self, a):
        pid = self.ctx["vars"].get("app_pid")
        self.ctx["vars"][a["var"]] = len(windows_of(pid))
        return True

    def act_assert_window_count_gt_poll(self, a):
        """轮询直到窗口数大于 before（最多 8 次，每次 0.6s）。"""
        pid = self.ctx["vars"].get("app_pid")
        before = self.ctx["vars"].get(a["var_before"], 0)
        for _ in range(8):
            if len(windows_of(pid)) > before:
                return True
            time.sleep(0.6)
        return self._assert(False, f"窗口数未增加（{before} → {len(windows_of(pid))}）")

    def act_new_document_if_dialog(self, a):
        """若存在 Open 对话框，点击 New Document（AXPress 语义）。"""
        pid = self.ctx["vars"].get("app_pid")
        try:
            els = find_elements(pid, role="AXButton", title="New Document")
        except BenchError:
            return True
        if els:
            self._helper("click", {"pid": pid, "path": els[0]["path"]})
            time.sleep(1.2)
        return True

    def act_save_dialog_type_path(self, a):
        """保存对话框：全局键盘输入路径到文件名框（需 ASCII 输入法）。"""
        pid = self.ctx["vars"].get("app_pid")
        # 对话框打开后默认聚焦文件名输入框；先全选清空旧名再输入
        self._helper("press-key", {"pid": pid, "key": "a", "modifiers": ["command"], "activate": True})
        self._helper("type-text", {"pid": pid, "text": a["path"], "activate": True})
        return True

    # ---- 断言 ----
    def _assert(self, ok, msg):
        if not ok:
            raise BenchError(msg, "assert_failed")
        return True

    def act_assert_app_window(self, a):
        pid = self.ctx["vars"].get("app_pid")
        if pid is None:
            pid = app_pid(a["app"])
        return self._assert(len(windows_of(pid)) > 0, f"{a['app']} 无窗口")

    def act_assert_frontmost(self, a):
        code, out, _ = run_sys(
            ['osascript', '-e',
             'tell application "System Events" to get name of first application process whose frontmost is true'],
            timeout=8,
        )
        ok = code == 0 and a["app"].lower() in out.lower()
        return self._assert(ok, f"前台不是 {a['app']}（got {out.strip()[:60]}）")

    def act_assert_window_title_contains(self, a):
        pid = self.ctx["vars"].get("app_pid")
        ok = any(a["text"] in (w.get("title") or "") for w in windows_of(pid))
        return self._assert(ok, f"窗口标题不含 {a['text']}")

    def act_assert_no_window_title(self, a):
        pid = self.ctx["vars"].get("app_pid")
        ok = not any(a["text"] in (w.get("title") or "") for w in windows_of(pid))
        return self._assert(ok, f"窗口标题仍含 {a['text']}")

    def act_assert_window_count_gt(self, a):
        pid = self.ctx["vars"].get("app_pid")
        before = self.ctx["vars"].get(a["var_before"], 0)
        now = len(windows_of(pid))
        return self._assert(now > before, f"窗口数未增加（{before} → {now}）")

    def act_assert_window_count_eq(self, a):
        pid = self.ctx["vars"].get("app_pid")
        before = self.ctx["vars"].get(a["var_before"], 0)
        now = len(windows_of(pid))
        delta = a.get("delta", 0)
        return self._assert(now == before + delta, f"窗口数不符（期望 {before + delta}，实际 {now}）")

    def act_assert_element_value_contains(self, a):
        pid = self.ctx["vars"].get("app_pid")
        els = find_elements(pid, role=a["role"])
        ok = any(a["text"] in (el.get("value") or "") for el in els)
        return self._assert(ok, f"元素值不含 {a['text']}")

    def act_assert_any_value_contains(self, a):
        pid = self.ctx["vars"].get("app_pid")
        els = find_elements(pid, value=a["text"])
        return self._assert(len(els) > 0, f"树中无元素值含 {a['text']}")

    def act_assert_any_scrollbar_changed(self, a):
        pid = self.ctx["vars"].get("app_pid")
        data = observe(pid)
        sb = [el for el in data.get("elements", []) if el.get("role") == "AXScrollBar"]
        # 滚动后滚动条值存在即视为动作已触发（值非 0/1 全幅）
        ok = len(sb) > 0
        return self._assert(ok, "未找到滚动条")

    def act_assert_file_exists(self, a):
        return self._assert(os.path.exists(a["path"]), f"文件不存在: {a['path']}")

    def act_assert_observe_ok(self, a):
        obs = self.ctx["vars"].get(a["var"])
        return self._assert(obs is not None and "elements" in obs, "observe 结果无效")


# ---------------------------------------------------------------------------
# 任务执行
# ---------------------------------------------------------------------------

def input_method_ascii():
    code, out, _ = run_sys(["defaults", "read", "com.apple.HIToolbox",
                            "AppleCurrentKeyboardLayoutInputSourceID"])
    if code != 0:
        return True  # 未知默认放行
    low = out.lower()
    return any(k in low for k in ("abc", "us-", "ansi", "qwerty"))


def task_needs_ascii_keyboard(task):
    """任务是否依赖 ASCII 键盘输入（type-text 或纯字符 press-key）。"""
    for action in task.get("actions", []):
        if action.get("type") in ("helper_type_text", "save_dialog_type_path"):
            return True
        if action.get("type") == "helper_press_key":
            mods = action.get("modifiers") or []
            if not any(m in ("command", "cmd", "control", "ctrl") for m in mods):
                return True
    return False


def run_task(task):
    """执行单个任务，返回指标 dict。"""
    ctx = {"vars": {}, "tool_calls": 0}
    result = {
        "task": task["id"],
        "name": task.get("name", task["id"]),
        "success": False,
        "wall_time_ms": 0,
        "steps": len(task.get("actions", [])),
        "llm_calls": 0,
        "vision_calls": 0,
        "screenshots": 0,
        "tool_calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "retries": 0,
        "error": "",
        "error_code": "",
    }
    started = time.time()
    runner = Runner(ctx)

    # 前置条件
    prereq = task.get("prereq", {})
    if prereq.get("app_exists"):
        if not app_exists(prereq["app_exists"]):
            result.update(success=True, error=f"skip: app 不存在 ({prereq['app_exists']})",
                          error_code="skipped_prereq")
            result["wall_time_ms"] = int((time.time() - started) * 1000)
            return result
    # 输入法：非 ASCII 时依赖 ASCII 键盘的任务跳过（记录环境因素，不污染成功率）
    if task_needs_ascii_keyboard(task) and not input_method_ascii():
        result.update(success=True, error="skip: 非 ASCII 输入法（拼音），键盘输入任务跳过",
                      error_code="skipped_input_method")
        result["wall_time_ms"] = int((time.time() - started) * 1000)
        return result

    try:
        for action in task.get("actions", []):
            runner.exec(action)
        result["success"] = True
    except BenchError as e:
        result["error"] = e.reason
        result["error_code"] = e.code
    except Exception as e:  # noqa: BLE001
        result["error"] = f"内部错误: {e}"
        result["error_code"] = "internal"
    finally:
        # 清理
        for cleanup in task.get("cleanup", []):
            try:
                Runner(ctx).exec(cleanup)
            except Exception:  # noqa: BLE001
                pass

    result["wall_time_ms"] = int((time.time() - started) * 1000)
    result["tool_calls"] = ctx["tool_calls"]
    return result


def main():
    args = sys.argv[1:]
    tasks_path = DEFAULT_TASKS
    output_path = DEFAULT_OUTPUT
    only = None

    i = 0
    while i < len(args):
        if args[i] == "--tasks" and i + 1 < len(args):
            tasks_path = Path(args[i + 1]); i += 2
        elif args[i] == "--output" and i + 1 < len(args):
            output_path = Path(args[i + 1]); i += 2
        elif args[i] == "--only" and i + 1 < len(args):
            only = args[i + 1]; i += 2
        elif args[i] == "--list":
            data = json.loads(Path(tasks_path).read_text())
            for t in data["tasks"]:
                print(f"{t['id']:28s} {t.get('name','')}")
            return 0
        else:
            print(f"未知参数: {args[i]}"); return 2

    data = json.loads(tasks_path.read_text())
    tasks = data["tasks"]
    if only:
        pats = [p for p in only.split(",") if p]
        tasks = [t for t in tasks if any(t["id"].startswith(p) or p in t["id"] for p in pats)]

    print(f"== DSH Computer Use Benchmark (Phase 0 Baseline) ==")
    print(f"任务数: {len(tasks)} | 输入法: {'ASCII' if input_method_ascii() else '非 ASCII(拼音等)'}")
    print()

    results = []
    for task in tasks:
        tag = task.get("prereq", {}).get("app_exists")
        print(f"  [{task['id']}] {task.get('name','')} ...", end=" ", flush=True)
        r = run_task(task)
        results.append(r)
        if r["error_code"] in ("skipped_prereq", "skipped_input_method"):
            print(f"SKIP [{r['error_code']}]")
        elif r["success"]:
            print(f"OK ({r['wall_time_ms']}ms, {r['tool_calls']} helper calls)")
        else:
            code = r["error_code"] or "?"
            print(f"FAIL [{code}] {r['error'][:80]}")

    # 汇总
    ran = [r for r in results if r["error_code"] not in ("skipped_prereq", "skipped_input_method")]
    skipped = [r for r in results if r["error_code"] in ("skipped_prereq", "skipped_input_method")]
    ok = [r for r in ran if r["success"]]
    print()
    print(f"== 结果: {len(ok)}/{len(ran)} 成功"
          + (f"（{len(skipped)} 跳过前置）" if skipped else ""))
    if ran:
        avg_ms = sum(r["wall_time_ms"] for r in ran) / len(ran)
        total_calls = sum(r["tool_calls"] for r in ran)
        print(f"平均耗时 {avg_ms:.0f}ms | 总 helper 调用 {total_calls}")
        print(f"成功率 {(len(ok)/len(ran))*100:.1f}%")

    # 输出
    report = {
        "meta": {**data.get("meta", {}), "runner": "run_benchmark.py",
                 "completed_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                 "input_method": "ascii" if input_method_ascii() else "non-ascii",
                 "summary": {
                     "total": len(tasks), "ran": len(ran), "success": len(ok),
                     "skipped": len(skipped),
                     "success_rate": round(len(ok) / len(ran) * 100, 1) if ran else 0,
                     "avg_wall_time_ms": round(sum(r["wall_time_ms"] for r in ran) / len(ran), 0) if ran else 0,
                     "total_tool_calls": sum(r["tool_calls"] for r in ran),
                 }},
        "results": results,
    }
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"\n已写入: {output_path}")

    csv_path = output_path.with_suffix(".csv")
    cols = ["task", "success", "wall_time_ms", "steps", "llm_calls", "vision_calls",
            "screenshots", "tool_calls", "input_tokens", "output_tokens", "retries",
            "error_code", "error"]
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in results:
            w.writerow({c: r.get(c, "") for c in cols})
    print(f"已写入: {csv_path}")

    return 0 if len(ok) == len(ran) else 1


if __name__ == "__main__":
    sys.exit(main())
