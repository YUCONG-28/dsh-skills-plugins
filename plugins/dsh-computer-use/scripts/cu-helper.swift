#!/usr/bin/env swift
// =============================================================================
// cu-helper.swift — dsh-computer-use 原生 helper（macOS，零第三方依赖）
//
// 用法：cu-helper <command>            # JSON 参数从 stdin 读，JSON 结果写 stdout
//   或编译后：bin/cu-helper <command>
//
// 命令：
//   ping            — helper 完整性自检 → {"ok": true, "version": N}
//   tcc-status      — Accessibility / Screen Recording 权限状态
//   apps            — 运行中的 GUI 应用列表（name/bundleId/pid/frontmost）
//   observe         — 返回目标 app 的窗口列表 + 有界 Accessibility 元素树
//                     （元素带 observation-local path、role、title、value、
//                     actions、frame、secure 标记；可选截图到指定 PNG 路径）
//   click           — AXPress 优先；接受元素 path（重新遍历定位）或屏幕坐标点
//   set-value       — 设置/清空可编辑元素的 Accessibility value（不经剪贴板）
//   type-text       — 向目标 pid 定向发送 Unicode 文本（CGEvent 键盘序列）
//   press-key       — 向目标 pid 发送有限词表按键 + modifiers
//   scroll          — 向目标 pid 定向发送有界方向滚动
//   drag            — 向目标 pid 发送窗口内两点拖拽（down/move/up）
//   perform-action  — 执行元素声明的 Accessibility action（如 AXPress/AXShowMenu）
//   screenshot      — 截取全屏或指定 pid 的前台窗口 → PNG 文件
//
// 成功输出：{"ok": true, ...}；失败输出 {"error": {"code": "COMPUTER_*", "message": "..."}}
// 任何错误都 fail closed（不猜测、不降级全局注入）。
//
// 编译：swiftc -O scripts/cu-helper.swift -o bin/cu-helper
// 权限：Accessibility（observe/act）与 Screen Recording（screenshot）按
//       调用方宿主进程的 TCC 授权检查——子进程继承 responsible process。
// =============================================================================
import Foundation
import ApplicationServices
import CoreGraphics
import AppKit
import ImageIO
import UniformTypeIdentifiers

// ---------------------------------------------------------------------------
// 基础输出 / 错误
// ---------------------------------------------------------------------------

func out(_ obj: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{\"error\":{\"code\":\"COMPUTER_JSON_FAILED\",\"message\":\"output serialization failed\"}}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

func fail(_ code: String, _ message: String) -> Never {
    out(["error": ["code": code, "message": message]])
}

func readStdinJSON() -> [String: Any] {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    if data.isEmpty { return [:] }
    guard let obj = try? JSONSerialization.jsonObject(with: data),
          let dict = obj as? [String: Any] else {
        fail("COMPUTER_PROTOCOL", "stdin JSON 参数无法解析")
    }
    return dict
}

func intArg(_ dict: [String: Any], _ key: String, _ fallback: Int) -> Int {
    if let n = dict[key] as? NSNumber { return n.intValue }
    if let n = dict[key] as? Int { return n }
    return fallback
}

/// JSON 数字 → Double（JSONSerialization 的数字是 NSNumber，可能是 CGFloat 存储，
/// `as? Double` / `as! Double` 会失败——统一走 NSNumber）。
func jsonDouble(_ value: Any?) -> Double? {
    return (value as? NSNumber)?.doubleValue
}

/// JSON 数字 → Int（同上）。
func jsonInt(_ value: Any?) -> Int? {
    return (value as? NSNumber)?.intValue
}

func strArg(_ dict: [String: Any], _ key: String) -> String? {
    return dict[key] as? String
}

func boolArg(_ dict: [String: Any], _ key: String, _ fallback: Bool) -> Bool {
    if let b = dict[key] as? Bool { return b }
    return fallback
}

// ---------------------------------------------------------------------------
// TCC 状态
// ---------------------------------------------------------------------------

func tccStatus() -> [String: Any] {
    var screenRecording = false
    if #available(macOS 10.15, *) {
        screenRecording = CGPreflightScreenCaptureAccess()
    }
    return ["accessibility": AXIsProcessTrusted(), "screenRecording": screenRecording]
}

// ---------------------------------------------------------------------------
// 应用 / 目标解析
// ---------------------------------------------------------------------------

func runningApps() -> [[String: Any]] {
    return NSWorkspace.shared.runningApplications
        .filter { $0.activationPolicy == .regular }
        .map { app in
            let info: [String: Any] = [
                "name": app.localizedName ?? "",
                "bundleId": app.bundleIdentifier ?? "",
                "pid": app.processIdentifier,
                "frontmost": app.isActive
            ]
            return info
        }
}

/// 从 args 解析目标 pid：显式 pid > bundleId > name（模糊匹配第一个）。
func resolvePid(_ args: [String: Any]) -> pid_t? {
    if let pidNum = args["pid"] as? NSNumber { return pid_t(pidNum.intValue) }
    if let pidInt = jsonInt(args["pid"]) { return pid_t(pidInt) }
    if let bundleId = strArg(args, "bundleId"), !bundleId.isEmpty {
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
        if let app = apps.first { return app.processIdentifier }
        return nil
    }
    if let name = strArg(args, "name"), !name.isEmpty {
        let candidates = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular && ($0.localizedName ?? "").lowercased().contains(name.lowercased()) }
        if let app = candidates.first { return app.processIdentifier }
        return nil
    }
    return nil
}

func appElement(_ pid: pid_t) -> AXUIElement {
    return AXUIElementCreateApplication(pid)
}

// ---------------------------------------------------------------------------
// AX 属性读取
// ---------------------------------------------------------------------------

func axCopy(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    return err == .success ? value : nil
}

func axString(_ element: AXUIElement, _ attribute: String) -> String? {
    return axCopy(element, attribute) as? String
}

func axBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
    guard let v = axCopy(element, attribute) else { return nil }
    if let b = v as? Bool { return b }
    if CFGetTypeID(v) == CFBooleanGetTypeID() { return CFBooleanGetValue((v as! CFBoolean)) }
    return nil
}

func axPoint(_ element: AXUIElement, _ attribute: String) -> CGPoint? {
    guard let raw = axCopy(element, attribute) else { return nil }
    var point = CGPoint.zero
    guard AXValueGetType(raw as! AXValue) == .cgPoint,
          AXValueGetValue(raw as! AXValue, .cgPoint, &point) else { return nil }
    return point
}

func axSize(_ element: AXUIElement, _ attribute: String) -> CGSize? {
    guard let raw = axCopy(element, attribute) else { return nil }
    var size = CGSize.zero
    guard AXValueGetType(raw as! AXValue) == .cgSize,
          AXValueGetValue(raw as! AXValue, .cgSize, &size) else { return nil }
    return size
}

func axActions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    let err = AXUIElementCopyActionNames(element, &names)
    guard err == .success, let array = names as? [String] else { return [] }
    return array
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    // 优先 children；个别容器（如 AXWebArea）需要 contents。
    if let children = axCopy(element, kAXChildrenAttribute) as? [AXUIElement] {
        return children
    }
    if let contents = axCopy(element, kAXContentsAttribute) as? [AXUIElement] {
        return contents
    }
    return []
}

/// 元素 frame（屏幕坐标，左上原点）：kAXPosition + kAXSize。
func axFrame(_ element: AXUIElement) -> [String: Any]? {
    guard let pos = axPoint(element, kAXPositionAttribute),
          let size = axSize(element, kAXSizeAttribute) else { return nil }
    return ["x": pos.x, "y": pos.y, "width": size.width, "height": size.height]
}

func truncate(_ s: String, _ limit: Int) -> String {
    if s.count <= limit { return s }
    let end = s.index(s.startIndex, offsetBy: limit)
    return String(s[..<end]) + "…"
}

// ---------------------------------------------------------------------------
// 有界树遍历
// ---------------------------------------------------------------------------

/// 元素可见文本值：普通字段读 value；安全文本字段一律 "[secure]"。
func elementValue(_ element: AXUIElement, _ role: String) -> (value: String?, secure: Bool) {
    if role == "AXSecureTextField" { return ("[secure]", true) }
    guard let raw = axCopy(element, kAXValueAttribute) else { return (nil, false) }
    if let s = raw as? String {
        if s.isEmpty { return (nil, false) }
        return (truncate(s, 500), false)
    }
    if let n = raw as? NSNumber {
        return (n.stringValue, false)
    }
    return (nil, false)
}

struct TreeWalker {
    let maxNodes: Int
    let maxDepth: Int
    var elements: [[String: Any]] = []
    var nodeCount = 0

    mutating func walk(_ element: AXUIElement, path: String, depth: Int) {
        guard nodeCount < maxNodes, depth <= maxDepth else { return }
        nodeCount += 1
        let role = axString(element, kAXRoleAttribute) ?? ""
        guard !role.isEmpty else { return }
        var info: [String: Any] = ["path": path, "role": role]
        if let title = axString(element, kAXTitleAttribute), !title.isEmpty {
            info["title"] = truncate(title, 300)
        }
        if let desc = axString(element, kAXDescriptionAttribute), !desc.isEmpty {
            info["description"] = truncate(desc, 300)
        }
        let (value, secure) = elementValue(element, role)
        if let v = value { info["value"] = v }
        if secure { info["secure"] = true }
        let actions = axActions(element)
        if !actions.isEmpty { info["actions"] = actions }
        if let frame = axFrame(element) { info["frame"] = frame }
        elements.append(info)
        let children = axChildren(element)
        if children.isEmpty { return }
        for (i, child) in children.enumerated() {
            walk(child, path: path.isEmpty ? "\(i)" : "\(path).\(i)", depth: depth + 1)
        }
    }
}

// ---------------------------------------------------------------------------
// 窗口信息
// ---------------------------------------------------------------------------

func axWindows(_ app: AXUIElement) -> [AXUIElement] {
    return (axCopy(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
}

/// 由 pid 匹配最近的 CG 窗口 id（供截图用；找不到返回 nil）。
func cgWindowId(pid: pid_t, axFrame: [String: Any]?) -> CGWindowID? {
    guard let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return nil }
    let candidates = info.filter { entry in
        guard let owner = jsonInt(entry[kCGWindowOwnerPID as String]), owner == Int(pid) else { return false }
        guard let layer = jsonInt(entry[kCGWindowLayer as String]), layer == 0 else { return false }
        return true
    }
    // 有 AX frame 时优先取 bounds 中心最接近的窗口
    if let f = axFrame,
       let x = jsonDouble(f["x"]), let y = jsonDouble(f["y"]),
       let w = jsonDouble(f["width"]), let h = jsonDouble(f["height"]) {
        let target = CGPoint(x: x + w / 2, y: y + h / 2)
        var best: (id: CGWindowID, dist: CGFloat)?
        for entry in candidates {
            guard let num = jsonInt(entry[kCGWindowNumber as String]),
                  let boundsDict = entry[kCGWindowBounds as String] as? [String: Any],
                  let bx = jsonDouble(boundsDict["X"]), let by = jsonDouble(boundsDict["Y"]),
                  let bw = jsonDouble(boundsDict["Width"]), let bh = jsonDouble(boundsDict["Height"]) else { continue }
            let center = CGPoint(x: bx + bw / 2, y: by + bh / 2)
            let dist = hypot(center.x - target.x, center.y - target.y)
            if best == nil || dist < best!.dist { best = (CGWindowID(num), dist) }
        }
        return best?.id
    }
    if let first = candidates.first, let num = jsonInt(first[kCGWindowNumber as String]) {
        return CGWindowID(num)
    }
    return nil
}

func windowInfo(_ app: AXUIElement, _ element: AXUIElement, _ axIndex: Int, appPid: pid_t) -> [String: Any] {
    var info: [String: Any] = ["axIndex": axIndex]
    if let title = axString(element, kAXTitleAttribute), !title.isEmpty {
        info["title"] = truncate(title, 200)
    }
    if let frame = axFrame(element) {
        info["frame"] = frame
        if let cgid = cgWindowId(pid: appPid, axFrame: frame) {
            info["cgWindowId"] = Int(cgid)
        }
    }
    if let minimized = axBool(element, kAXMinimizedAttribute) {
        info["minimized"] = minimized
    }
    return info
}

// ---------------------------------------------------------------------------
// observe
// ---------------------------------------------------------------------------

func runObserve(_ args: [String: Any]) -> Never {
    let accessibility = AXIsProcessTrusted()
    if !accessibility {
        fail("COMPUTER_PERMISSION_REQUIRED",
             "缺少 macOS 辅助功能（Accessibility）权限：请在 系统设置 → 隐私与安全性 → 辅助功能 中为运行 dsh 的宿主进程授权后重试。")
    }
    guard let pid = resolvePid(args) else {
        fail("COMPUTER_APP_NOT_FOUND", "找不到目标应用（请先用 computer_list_apps 确认 pid / bundleId / name）")
    }
    let app = appElement(pid)
    let maxNodes = max(1, min(intArg(args, "maxNodes", 300), 3000))
    let maxDepth = max(1, min(intArg(args, "maxDepth", 24), 64))

    // 窗口列表
    let windows = axWindows(app)
    var windowInfos: [[String: Any]] = []
    for (i, w) in windows.enumerated() {
        windowInfos.append(windowInfo(app, w, i, appPid: pid))
    }

    // 目标窗口：显式 axIndex > focused window > 第一个窗口
    let targetWindow: AXUIElement?
    if let winIdx = jsonInt(args["axIndex"]), winIdx >= 0, winIdx < windows.count {
        targetWindow = windows[winIdx]
    } else if let focusedRaw = axCopy(app, kAXFocusedWindowAttribute), CFGetTypeID(focusedRaw) == AXUIElementGetTypeID() {
        targetWindow = (focusedRaw as! AXUIElement)
    } else {
        targetWindow = windows.first
    }
    guard let window = targetWindow else {
        fail("COMPUTER_NO_WINDOW", "目标应用没有可观察的窗口（最小化或无窗口）")
    }

    // 遍历树（从窗口元素开始，path 为窗口内子元素路径）
    var walker = TreeWalker(maxNodes: maxNodes, maxDepth: maxDepth)
    walker.walk(window, path: "", depth: 0)

    var result: [String: Any] = [
        "app": [
            "pid": Int(pid),
            "bundleId": NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? "",
            "name": NSRunningApplication(processIdentifier: pid)?.localizedName ?? ""
        ],
        "windows": windowInfos,
        "elements": walker.elements,
        "nodeCount": walker.elements.count,
        "maxNodesReached": walker.elements.count >= maxNodes,
        "permissions": tccStatus()
    ]

    // 可选截图（Screen Recording 权限）
    if boolArg(args, "screenshot", false) {
        guard let path = strArg(args, "screenshotPath"), !path.isEmpty else {
            fail("COMPUTER_PROTOCOL", "screenshot=true 时需要 screenshotPath")
        }
        let shot = captureScreenshot(pid: pid, windowId: nil, path: path)
        result["screenshot"] = shot
    }
    out(result)
}

// ---------------------------------------------------------------------------
// 元素定位（动作前重定位 + 可选语义 rebind）
// ---------------------------------------------------------------------------

/// 在目标窗口树内按 path 重定位元素。
func locateByPath(_ root: AXUIElement, _ path: String, maxNodes: Int, maxDepth: Int) -> AXUIElement? {
    let parts = path.split(separator: ".").compactMap { Int($0) }
    guard !parts.isEmpty else { return nil }
    var current = root
    for (i, idx) in parts.enumerated() {
        let children = axChildren(current)
        guard idx >= 0, idx < children.count else { return nil }
        current = children[idx]
        if i == parts.count - 1 { return current }
    }
    return nil
}

/// 语义 rebind：按 (role, title) 在窗口树内找唯一匹配（title 非空）。
func locateSemantic(_ root: AXUIElement, role: String, title: String, maxNodes: Int, maxDepth: Int) -> AXUIElement? {
    var matches: [AXUIElement] = []
    var count = 0
    func dfs(_ element: AXUIElement, depth: Int) {
        guard count < maxNodes, depth <= maxDepth else { return }
        count += 1
        let r = axString(element, kAXRoleAttribute) ?? ""
        if r == role {
            let t = axString(element, kAXTitleAttribute) ?? ""
            if t == title { matches.append(element) }
        }
        for child in axChildren(element) { dfs(child, depth: depth + 1) }
    }
    dfs(root, depth: 0)
    return matches.count == 1 ? matches[0] : nil
}

/// 从 args 解析目标窗口：axIndex > focused window。
func resolveWindow(_ app: AXUIElement, _ args: [String: Any]) -> AXUIElement? {
    let windows = axWindows(app)
    if let winIdx = jsonInt(args["axIndex"]), winIdx >= 0, winIdx < windows.count {
        return windows[winIdx]
    }
    if let focusedRaw = axCopy(app, kAXFocusedWindowAttribute), CFGetTypeID(focusedRaw) == AXUIElementGetTypeID() {
        return (focusedRaw as! AXUIElement)
    }
    return windows.first
}

/// 解析动作目标：优先元素（path / rebind），否则屏幕坐标点（需在窗口 frame 内）。
/// 返回 (元素?, 屏幕坐标?, 错误?)。错误非 nil 时调用方 fail closed。
func resolveTarget(_ app: AXUIElement, _ args: [String: Any]) -> (AXUIElement?, CGPoint?, [String: Any]?) {
    guard let window = resolveWindow(app, args) else {
        return (nil, nil, ["code": "COMPUTER_NO_WINDOW", "message": "目标应用没有可用窗口"])
    }
    let maxNodes = max(1, min(intArg(args, "maxNodes", 300), 3000))
    let maxDepth = max(1, min(intArg(args, "maxDepth", 24), 64))
    if let path = strArg(args, "path"), !path.isEmpty {
        if let el = locateByPath(window, path, maxNodes: maxNodes, maxDepth: maxDepth) {
            return (el, nil, nil)
        }
        // path 失败：允许语义 rebind
        if boolArg(args, "allowRebind", false) {
            let role = strArg(args, "role") ?? ""
            let title = strArg(args, "title") ?? ""
            if !role.isEmpty, !title.isEmpty {
                if let el = locateSemantic(window, role: role, title: title, maxNodes: maxNodes, maxDepth: maxDepth) {
                    return (el, nil, nil)
                }
                return (nil, nil, ["code": "COMPUTER_TARGET_AMBIGUOUS",
                                   "message": "元素已变化且语义重绑定未找到唯一匹配（role=\(role) title=\(title)）；请重新 computer_observe"])
            }
        }
        return (nil, nil, ["code": "COMPUTER_TARGET_STALE",
                           "message": "元素已变化（path=\(path) 重定位失败）；请重新 computer_observe 获取新鲜 observation"])
    }
    if let x = jsonDouble(args["x"]), let y = jsonDouble(args["y"]) {
        // 坐标动作：必须落在窗口 frame 内（fail closed）
        if let frame = axFrame(window) {
            guard let fx = jsonDouble(frame["x"]), let fy = jsonDouble(frame["y"]),
                  let fw = jsonDouble(frame["width"]), let fh = jsonDouble(frame["height"]) else {
                return (nil, nil, ["code": "COMPUTER_TARGET_NO_FRAME", "message": "窗口缺少 frame 信息"])
            }
            guard x >= fx, x <= fx + fw, y >= fy, y <= fy + fh else {
                return (nil, nil, ["code": "COMPUTER_POINT_OUTSIDE_WINDOW",
                                   "message": "坐标点 (\(x), \(y)) 不在目标窗口 frame (\(fx), \(fy), \(fw)x\(fh)) 内"])
            }
        }
        return (nil, CGPoint(x: x, y: y), nil)
    }
    return (nil, nil, ["code": "COMPUTER_PROTOCOL", "message": "动作需要 path（元素）或 x/y（屏幕坐标）"])
}

// ---------------------------------------------------------------------------
// 输入事件（定向 pid，不移动系统光标 / 不做全局注入）
// ---------------------------------------------------------------------------

func elementCenter(_ element: AXUIElement) -> CGPoint? {
    guard let frame = axFrame(element) else { return nil }
    guard let x = jsonDouble(frame["x"]), let y = jsonDouble(frame["y"]),
          let w = jsonDouble(frame["width"]), let h = jsonDouble(frame["height"]) else { return nil }
    return CGPoint(x: x + w / 2, y: y + h / 2)
}

func postMouse(_ type: CGEventType, _ point: CGPoint, _ pid: pid_t, button: CGMouseButton = .left) {
    if let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) {
        event.postToPid(pid)
    }
}

func postKey(_ keyCode: CGKeyCode, down: Bool, pid: pid_t, flags: CGEventFlags = []) {
    if let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: down) {
        event.flags = flags
        event.postToPid(pid)
    }
}

func postText(_ text: String, pid: pid_t) {
    let source = CGEventSource(stateID: .hidSystemState)
    for scalar in text.unicodeScalars {
        var chars = [UniChar(scalar.value)]
        if let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true) {
            down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &chars)
            down.postToPid(pid)
        }
        if let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) {
            up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &chars)
            up.postToPid(pid)
        }
    }
}

/// 有限词表按键码（安全：不暴露任意 virtual key）。
func keyCode(_ name: String) -> CGKeyCode? {
    let lower = name.lowercased()
    let map: [String: CGKeyCode] = [
        "return": 36, "enter": 36, "tab": 48, "space": 49, "escape": 53, "esc": 53,
        "delete": 51, "backspace": 51, "forwarddelete": 117,
        "up": 126, "down": 125, "left": 123, "right": 124,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
        "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
        "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3, "g": 5, "h": 4,
        "i": 34, "j": 38, "k": 40, "l": 37, "m": 46, "n": 45, "o": 31, "p": 35,
        "q": 12, "r": 15, "s": 1, "t": 17, "u": 32, "v": 9, "w": 13, "x": 7,
        "y": 16, "z": 6,
        "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23,
        "6": 22, "7": 26, "8": 28, "9": 25,
        "comma": 43, "period": 47, "slash": 44, "semicolon": 41, "quote": 39,
        "backslash": 42, "bracketleft": 33, "bracketright": 30, "minus": 27, "equal": 24
    ]
    return map[lower]
}

func flagsFromModifiers(_ modifiers: [String]) -> CGEventFlags {
    var flags: CGEventFlags = []
    for m in modifiers {
        switch m.lowercased() {
        case "command", "cmd": flags.insert(.maskCommand)
        case "option", "alt": flags.insert(.maskAlternate)
        case "control", "ctrl": flags.insert(.maskControl)
        case "shift": flags.insert(.maskShift)
        default: break
        }
    }
    return flags
}

// ---------------------------------------------------------------------------
// 截图
// ---------------------------------------------------------------------------

func writePNG(_ image: CGImage, to path: String) -> Bool {
    guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        return false
    }
    CGImageDestinationAddImage(dest, image, nil)
    return CGImageDestinationFinalize(dest)
}

/// 截取全屏或指定 pid 的前台窗口（Screen Recording 权限）。返回截图元数据。
/// macOS 15+ 废弃了 CGWindowListCreateImage，改用 screencapture CLI（TCC 屏幕
/// 录制权限按调用方宿主进程的 responsible process 检查，行为一致）。
func captureScreenshot(pid: pid_t?, windowId: CGWindowID?, path: String) -> [String: Any] {
    if !CGPreflightScreenCaptureAccess() {
        fail("COMPUTER_SCREEN_RECORDING_REQUIRED",
             "缺少 macOS 屏幕录制（Screen Recording）权限：请在 系统设置 → 隐私与安全性 → 屏幕录制 中为运行 dsh 的宿主进程授权后重试。")
    }
    // 目标窗口 id：显式 windowId > pid 的前台窗口
    var target: CGWindowID?
    if let wId = windowId { target = wId }
    else if let pid = pid { target = cgWindowIdForPid(pid) }
    let status: Int32
    if let wId = target {
        status = runScreencapture(["-x", "-o", "-l\(wId)", path])
    } else {
        status = runScreencapture(["-x", path])
    }
    guard status == 0 else {
        fail("COMPUTER_SCREENSHOT_FAILED", "screencapture 失败（exit=\(status)）")
    }
    // 读取尺寸（尽量；失败不影响主流程）
    var width = 0, height = 0
    if let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
       let img = CGImageSourceCreateImageAtIndex(src, 0, nil) {
        width = img.width
        height = img.height
    }
    let attrs = try? FileManager.default.attributesOfItem(atPath: path)
    let bytes = (attrs?[.size] as? NSNumber)?.intValue ?? 0
    return ["path": path, "width": width, "height": height, "bytes": bytes]
}

/// 调用 screencapture 截图。返回退出码。
func runScreencapture(_ args: [String]) -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    process.arguments = args
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe
    do {
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus
    } catch {
        return -1
    }
}

/// 解析 pid 的 CG 窗口 id（optionOnScreenOnly 中 ownerPID 匹配、layer==0 的第一个）。
func cgWindowIdForPid(_ pid: pid_t) -> CGWindowID? {
    guard let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return nil }
    for entry in info {
        guard let owner = jsonInt(entry[kCGWindowOwnerPID as String]), owner == Int(pid) else { continue }
        guard let layer = jsonInt(entry[kCGWindowLayer as String]), layer == 0 else { continue }
        if let num = jsonInt(entry[kCGWindowNumber as String]) { return CGWindowID(num) }
    }
    return nil
}

// ---------------------------------------------------------------------------
// 各动作命令
// ---------------------------------------------------------------------------

func requireAccessibility() {
    if !AXIsProcessTrusted() {
        fail("COMPUTER_PERMISSION_REQUIRED",
             "缺少 macOS 辅助功能（Accessibility）权限：请在 系统设置 → 隐私与安全性 → 辅助功能 中为运行 dsh 的宿主进程授权后重试。")
    }
}

func requirePid(_ args: [String: Any]) -> pid_t {
    guard let pid = resolvePid(args) else {
        fail("COMPUTER_APP_NOT_FOUND", "找不到目标应用（请先用 computer_list_apps 确认 pid / bundleId / name）")
    }
    return pid
}

func runClick(_ args: [String: Any]) -> Never {
    requireAccessibility()
    let pid = requirePid(args)
    let app = appElement(pid)
    let (element, point, error) = resolveTarget(app, args)
    if let err = error { fail(err["code"] as! String, err["message"] as! String) }
    let double = boolArg(args, "double", false)
    let button: CGMouseButton = (strArg(args, "button")?.lowercased() == "right") ? .right : .left
    let preferSemantic = (strArg(args, "prefer") ?? "semantic") != "coordinate"
    // activate=true：激活目标并在前台确认后用全局鼠标（真实点击）；否则定向投递
    let activated = maybeActivate(pid: pid, args: args)

    func clickAt(_ p: CGPoint) {
        if activated {
            postMouseGlobal(.leftMouseDown, p, button: button)
            usleep(40_000)
            postMouseGlobal(.leftMouseUp, p, button: button)
        } else {
            postMouse(.leftMouseDown, p, pid, button: button)
            postMouse(.leftMouseUp, p, pid, button: button)
        }
        if double {
            if activated {
                postMouseGlobal(.leftMouseDown, p, button: button)
                usleep(40_000)
                postMouseGlobal(.leftMouseUp, p, button: button)
            } else {
                postMouse(.leftMouseDown, p, pid, button: button)
                postMouse(.leftMouseUp, p, pid, button: button)
            }
        }
    }

    if let el = element {
        let actions = axActions(el)
        // 语义优先：AXPress 存在且调用方未强制坐标
        if preferSemantic, actions.contains(kAXPressAction as String) {
            let err = AXUIElementPerformAction(el, kAXPressAction as CFString)
            if err == .success { out(["ok": true, "mode": "axpress", "activated": activated]) }
            // AXPress 失败 → 允许坐标 fallback（调用方已同意 allowCoordinateFallback）
            if !boolArg(args, "allowCoordinateFallback", false) {
                fail("COMPUTER_ACTION_FAILED", "AXPress 失败（error=\(err.rawValue)）；可设 allowCoordinateFallback=true 用元素中心坐标")
            }
        }
        guard let center = elementCenter(el) else {
            fail("COMPUTER_TARGET_NO_FRAME", "元素没有可用的坐标 frame，无法执行坐标点击")
        }
        clickAt(center)
        out(["ok": true, "mode": "coordinate", "activated": activated, "point": ["x": center.x, "y": center.y]])
    } else if let pt = point {
        clickAt(pt)
        out(["ok": true, "mode": "coordinate", "activated": activated, "point": ["x": pt.x, "y": pt.y]])
    } else {
        fail("COMPUTER_PROTOCOL", "click 需要 path 或 x/y")
    }
}

func runSetValue(_ args: [String: Any]) -> Never {
    requireAccessibility()
    let pid = requirePid(args)
    let app = appElement(pid)
    let (element, _, error) = resolveTarget(app, args)
    if let err = error { fail(err["code"] as! String, err["message"] as! String) }
    guard let el = element else {
        fail("COMPUTER_PROTOCOL", "set-value 需要元素 path")
    }
    let value: CFTypeRef
    if let v = strArg(args, "value") {
        value = v as CFTypeRef
    } else if boolArg(args, "clear", false) {
        value = "" as CFTypeRef
    } else {
        fail("COMPUTER_PROTOCOL", "set-value 需要 value 或 clear=true")
    }
    let err = AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, value)
    guard err == .success else {
        fail("COMPUTER_ACTION_FAILED", "设置 value 失败（error=\(err.rawValue)）")
    }
    out(["ok": true])
}

/// 当前键盘输入源 id（com.apple.HIToolbox 域；运行时的当前值）。
/// 拼音/五笔/日文/韩文等非 ASCII 输入法会拦截合成键盘事件（进入候选窗），
/// 导致定向/全局键盘输入不生效——fail-closed 前先检测。
func currentInputSourceId() -> String? {
    if let v = CFPreferencesCopyAppValue("AppleCurrentKeyboardLayoutInputSourceID" as CFString,
                                         "com.apple.HIToolbox" as CFString) as? String {
        return v
    }
    return nil
}

/// 当前输入法是否冲突（非 ASCII 类）。返回冲突输入法 id 或 nil。
func inputMethodConflict() -> String? {
    guard let id = currentInputSourceId(), !id.isEmpty else { return nil }
    let lower = id.lowercased()
    let asciiish = lower.contains("abc") || lower.contains("us") || lower.contains("ansi") || lower.contains("qwerty")
    if asciiish { return nil }
    return id
}

/// 键盘输入前可选激活目标应用（keyboardPolicy: activate）。
/// 后台应用（-g 打开、未激活）的定向键盘事件会被 macOS 部分丢弃；
/// activate=true 时先把应用带到前台再输入，保证可靠性（会短暂抢焦点）。
/// 返回目标是否已成为前台（决定可用全局键盘路由）。
func maybeActivate(pid: pid_t, args: [String: Any]) -> Bool {
    if boolArg(args, "activate", false) {
        NSRunningApplication(processIdentifier: pid)?.activate(options: [])
        usleep(300_000)
        return NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
    }
    return false
}

/// 全局鼠标事件（CGEventPost）：activate 模式（用户接受激活）下使用，
/// 会移动系统光标到目标点——preserve 模式绝不使用。
func postMouseGlobal(_ type: CGEventType, _ point: CGPoint, button: CGMouseButton = .left) {
    if let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) {
        event.post(tap: .cghidEventTap)
    }
}

/// 全局键盘事件（CGEventPost）：只在前台确认为目标应用时使用（activate 模式）。
/// 使用 HID 事件源（与 postTextGlobal 一致）；down/up 间加间隔保证组合键被识别。
func postKeyGlobal(_ keyCode: CGKeyCode, down: Bool, flags: CGEventFlags) {
    let source = CGEventSource(stateID: .hidSystemState)
    if let event = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: down) {
        event.flags = flags
        event.post(tap: .cghidEventTap)
    }
    if down { usleep(30_000) }
}

/// 全局 Unicode 文本键盘（CGEventPost）：同上。
/// 每字符间加小间隔（约 12ms），保证目标应用 run loop 能消化事件。
func postTextGlobal(_ text: String) {
    let source = CGEventSource(stateID: .hidSystemState)
    for scalar in text.unicodeScalars {
        var chars = [UniChar(scalar.value)]
        if let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true) {
            down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &chars)
            down.post(tap: .cghidEventTap)
        }
        if let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) {
            up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &chars)
            up.post(tap: .cghidEventTap)
        }
        usleep(12_000)
    }
}

func runTypeText(_ args: [String: Any]) -> Never {
    requireAccessibility()
    let pid = requirePid(args)
    guard let text = strArg(args, "text"), !text.isEmpty else {
        fail("COMPUTER_PROTOCOL", "type-text 需要非空 text")
    }
    if let im = inputMethodConflict() {
        fail("COMPUTER_INPUT_METHOD_CONFLICT",
             "当前输入法为 \(im)（非 ASCII 键盘），合成键盘事件会进入输入法候选窗而不是目标应用；请切换到 ABC/English 输入法后重试，或改用 computer_set_value 语义写入文本")
    }
    // 可选：先点击目标元素建立 first responder，再输入——
    // activate 应用不等于焦点在目标控件；activate 模式下用全局鼠标点击
    // 元素中心（真实模拟用户点击输入框再打字），preserve 模式仅 AX 语义聚焦尽力。
    var focusedPath = ""
    if let path = strArg(args, "path"), !path.isEmpty {
        let app = appElement(pid)
        if let window = resolveWindow(app, args) {
            let maxNodes = max(1, min(intArg(args, "maxNodes", 300), 3000))
            let maxDepth = max(1, min(intArg(args, "maxDepth", 24), 64))
            if let el = locateByPath(window, path, maxNodes: maxNodes, maxDepth: maxDepth) {
                let activatedFirst = maybeActivate(pid: pid, args: args)
                if activatedFirst, let center = elementCenter(el) {
                    // 全局点击：建立 first responder（会移动系统光标，仅 activate 模式）
                    postMouseGlobal(.leftMouseDown, center)
                    usleep(40_000)
                    postMouseGlobal(.leftMouseUp, center)
                    focusedPath = path
                } else {
                    // 尽力语义聚焦（AXFocused），可能无效
                    _ = AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
                    focusedPath = path
                }
                usleep(150_000)
            }
        }
    }
    let activated = maybeActivate(pid: pid, args: args)
    if activated {
        // 前台确认是目标：全局键盘（可靠）
        postTextGlobal(text)
        out(["ok": true, "chars": text.count, "activated": true, "route": "global-frontmost", "focusedPath": focusedPath])
    }
    // 未激活（preserve 模式）或激活未成功：定向投递（后台应用可能丢字符）
    postText(text, pid: pid)
    out(["ok": true, "chars": text.count, "activated": activated, "route": "targeted", "focusedPath": focusedPath])
}

func runPressKey(_ args: [String: Any]) -> Never {
    requireAccessibility()
    let pid = requirePid(args)
    guard let keyName = strArg(args, "key"), let code = keyCode(keyName) else {
        fail("COMPUTER_KEY_NOT_ALLOWED",
             "按键不在有限词表内（支持：return/tab/space/escape/delete/方向键/home/end/pageup/pagedown/F1-F12/a-z/0-9/常见符号与 command/option/control/shift 修饰键）")
    }
    let modifiers = args["modifiers"] as? [String] ?? []
    // 输入法检测仅针对会产生字符的按键：编辑/导航键（delete/方向键/home 等）
    // 与带修饰的组合键不受输入法影响，直接放行。
    let editKeys: Set<String> = ["return", "enter", "tab", "space", "escape", "esc", "delete", "backspace",
                                 "forwarddelete", "up", "down", "left", "right", "home", "end",
                                 "pageup", "pagedown", "f1", "f2", "f3", "f4", "f5", "f6", "f7",
                                 "f8", "f9", "f10", "f11", "f12"]
    let isEditKey = editKeys.contains(keyName.lowercased())
    if modifiers.isEmpty, !isEditKey, let im = inputMethodConflict() {
        fail("COMPUTER_INPUT_METHOD_CONFLICT",
             "当前输入法为 \(im)（非 ASCII 键盘），普通字符键会进入输入法候选窗；请切换到 ABC/English 输入法后重试，或改用 computer_set_value")
    }
    let flags = flagsFromModifiers(modifiers)
    let activated = maybeActivate(pid: pid, args: args)
    if activated {
        postKeyGlobal(code, down: true, flags: flags)
        postKeyGlobal(code, down: false, flags: flags)
        out(["ok": true, "key": keyName, "modifiers": modifiers, "activated": true, "route": "global-frontmost"])
    }
    postKey(code, down: true, pid: pid, flags: flags)
    postKey(code, down: false, pid: pid, flags: flags)
    out(["ok": true, "key": keyName, "modifiers": modifiers, "activated": activated, "route": "targeted"])
}

func runScroll(_ args: [String: Any]) -> Never {
    requireAccessibility()
    let pid = requirePid(args)
    guard let direction = strArg(args, "direction") else {
        fail("COMPUTER_PROTOCOL", "scroll 需要 direction（up/down/left/right）")
    }
    let amount = max(1, min(intArg(args, "amount", 3), 100))
    let units: CGScrollEventUnit = (strArg(args, "unit") ?? "line") == "pixel" ? .pixel : .line
    let wheel1: Int32
    let wheel2: Int32
    switch direction.lowercased() {
    case "up": wheel1 = Int32(amount); wheel2 = 0
    case "down": wheel1 = -Int32(amount); wheel2 = 0
    case "left": wheel1 = 0; wheel2 = Int32(amount)
    case "right": wheel1 = 0; wheel2 = -Int32(amount)
    default: fail("COMPUTER_PROTOCOL", "scroll direction 只支持 up/down/left/right")
    }
    if let event = CGEvent(scrollWheelEvent2Source: nil, units: units, wheelCount: 2, wheel1: wheel1, wheel2: wheel2, wheel3: 0) {
        event.postToPid(pid)
        out(["ok": true, "direction": direction, "amount": amount])
    }
    fail("COMPUTER_ACTION_FAILED", "无法创建滚动事件")
}

func runDrag(_ args: [String: Any]) -> Never {
    requireAccessibility()
    let pid = requirePid(args)
    guard let fx = jsonDouble(args["fromX"]), let fy = jsonDouble(args["fromY"]),
          let tx = jsonDouble(args["toX"]), let ty = jsonDouble(args["toY"]) else {
        fail("COMPUTER_PROTOCOL", "drag 需要 fromX/fromY/toX/toY（屏幕坐标）")
    }
    let from = CGPoint(x: fx, y: fy)
    let to = CGPoint(x: tx, y: ty)
    let steps = 12
    // activate 模式：全局拖拽（前台应用 postToPid 鼠标无效）；否则定向投递
    let activated = maybeActivate(pid: pid, args: args)
    if activated {
        postMouseGlobal(.leftMouseDown, from)
        usleep(30_000)
        for i in 1...steps {
            let t = CGFloat(i) / CGFloat(steps)
            let p = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
            postMouseGlobal(.leftMouseDragged, p)
            usleep(12_000)
        }
        usleep(30_000)
        postMouseGlobal(.leftMouseUp, to)
    } else {
        postMouse(.leftMouseDown, from, pid)
        for i in 1...steps {
            let t = CGFloat(i) / CGFloat(steps)
            let p = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
            postMouse(.leftMouseDragged, p, pid)
            usleep(12_000)
        }
        postMouse(.leftMouseUp, to, pid)
    }
    out(["ok": true, "from": ["x": fx, "y": fy], "to": ["x": tx, "y": ty], "activated": activated])
}

func runPerformAction(_ args: [String: Any]) -> Never {
    requireAccessibility()
    let pid = requirePid(args)
    let app = appElement(pid)
    let (element, _, error) = resolveTarget(app, args)
    if let err = error { fail(err["code"] as! String, err["message"] as! String) }
    guard let el = element else {
        fail("COMPUTER_PROTOCOL", "perform-action 需要元素 path")
    }
    guard let action = strArg(args, "action"), !action.isEmpty else {
        fail("COMPUTER_PROTOCOL", "perform-action 需要 action（元素声明的 accessibility action）")
    }
    let actions = axActions(el)
    guard actions.contains(action) else {
        fail("COMPUTER_ACTION_NOT_ALLOWED", "元素不支持该 action（可用: \(actions.joined(separator: ", "))）")
    }
    let err = AXUIElementPerformAction(el, action as CFString)
    guard err == .success else {
        fail("COMPUTER_ACTION_FAILED", "执行 action \(action) 失败（error=\(err.rawValue)）")
    }
    out(["ok": true, "action": action])
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

let command = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ping"
let args = readStdinJSON()

switch command {
case "ping":
    out(["ok": true, "version": 1])
case "tcc-status":
    out(["ok": true, "permissions": tccStatus()])
case "apps":
    out(["ok": true, "apps": runningApps()])
case "observe":
    runObserve(args)
case "click":
    runClick(args)
case "set-value":
    runSetValue(args)
case "type-text":
    runTypeText(args)
case "press-key":
    runPressKey(args)
case "scroll":
    runScroll(args)
case "drag":
    runDrag(args)
case "perform-action":
    runPerformAction(args)
case "screenshot":
    let pid: pid_t? = {
        if let n = args["pid"] as? NSNumber { return pid_t(n.intValue) }
        if let i = jsonInt(args["pid"]) { return pid_t(i) }
        return nil
    }()
    let windowId = (args["windowId"] as? NSNumber)?.uint32Value
    guard let path = strArg(args, "path"), !path.isEmpty else {
        fail("COMPUTER_PROTOCOL", "screenshot 需要 path")
    }
    out(["ok": true, "screenshot": captureScreenshot(pid: pid, windowId: windowId, path: path)])
default:
    fail("COMPUTER_UNKNOWN_COMMAND", "未知命令: \(command)")
}
