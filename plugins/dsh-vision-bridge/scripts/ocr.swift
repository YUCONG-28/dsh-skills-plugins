#!/usr/bin/env swift
// =============================================================================
// imgtool.swift — vision-bridge 本地图像工具（macOS，零第三方依赖）
//
// 子命令：
//   ocr <image>            — 本地 OCR（macOS Vision，zh-Hans+en-US，自动按 EXIF
//                            方向纠正）→ stdout 输出 JSON：
//                            {"text": 按阅读顺序拼接的全文, "charCount": N,
//                             "lineCount": N, "lines": [{text,confidence,x,y}]}
//   orient <image>         — 输出 EXIF orientation 原始值（1/3/6/8 等，0 表示无）
//   fix <in> <out>         — 按 EXIF orientation 旋转到正位 + 剥离全部 EXIF 元数据
//                            （含 GPS），写重编码后的 JPEG 到 <out>
//   strip <in> <out>       — 仅剥离 EXIF（不旋转），写重编码 JPEG 到 <out>
//
// 用法：swift ocr.swift <subcommand> ...；或先 swiftc -O 编译成二进制加速。
// 任何失败输出 {"error": "..."} 或非零退出码，由插件降级处理。
// =============================================================================
import Foundation
import Vision
import ImageIO
import CoreGraphics

func fail(_ message: String) -> Never {
    if CommandLine.arguments[1] == "ocr" {
        print("{\"error\": \"\(message)\"}")
    } else {
        FileHandle.standardError.write("error: \(message)\n".data(using: .utf8)!)
    }
    exit(1)
}

func readCGImage(_ path: String) -> (CGImage, CGImagePropertyOrientation) {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fail("cannot read image: \(path)")
    }
    let orientation: CGImagePropertyOrientation = {
        guard let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let raw = props[kCGImagePropertyOrientation] as? UInt32,
              let o = CGImagePropertyOrientation(rawValue: raw) else { return .up }
        return o
    }()
    return (image, orientation)
}

func runOcr(_ path: String) {
    let (cgImage, orientation) = readCGImage(path)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
    do {
        try handler.perform([request])
    } catch {
        fail("vision perform failed: \(error.localizedDescription)")
    }
    var lines: [[String: Any]] = []
    for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let box = observation.boundingBox
        lines.append([
            "text": candidate.string,
            "confidence": candidate.confidence,
            "x": Double(box.origin.x),
            "y": Double(box.origin.y)
        ])
    }
    // 按阅读顺序：y 从高到低（视觉上顶→底），同排按 x 从左到右
    lines.sort { a, b in
        let ay = a["y"] as! Double, by = b["y"] as! Double
        if abs(ay - by) > 0.02 { return ay > by }
        return (a["x"] as! Double) < (b["x"] as! Double)
    }
    let text = lines.map { $0["text"] as! String }.joined(separator: "\n")
    let out: [String: Any] = ["text": text, "charCount": text.count, "lineCount": lines.count, "lines": lines]
    if let data = try? JSONSerialization.data(withJSONObject: out),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    } else {
        fail("json serialize failed")
    }
}

func exifOrientationValue(_ path: String) -> Int {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let raw = props[kCGImagePropertyOrientation] as? UInt32 else { return 0 }
    return Int(raw)
}

/// EXIF orientation → 顺时针旋转角度（1=0, 3=180, 6=90, 8=270；2/4/5/7 带翻转忽略）
func rotationFor(_ orientation: Int) -> Int {
    switch orientation {
    case 3: return 180
    case 6: return 90
    case 8: return 270
    default: return 0
    }
}

func rotateDegrees(_ image: CGImage, _ degrees: Int) -> CGImage? {
    let w = image.width, h = image.height
    let rw = degrees % 180 == 0 ? w : h
    let rh = degrees % 180 == 0 ? h : w
    guard let ctx = CGContext(
        data: nil, width: rw, height: rh, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }
    ctx.translateBy(x: CGFloat(rw) / 2, y: CGFloat(rh) / 2)
    ctx.rotate(by: CGFloat(degrees) * .pi / 180)
    ctx.translateBy(x: -CGFloat(w) / 2, y: -CGFloat(h) / 2)
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage()
}

/// 重编码（剥离 EXIF），可选先旋转
func rewrite(_ path: String, _ outPath: String, rotate: Bool) {
    let (cgImage, _) = readCGImage(path)
    var final = cgImage
    if rotate {
        let deg = rotationFor(exifOrientationValue(path))
        if deg != 0 {
            guard let rotated = rotateDegrees(cgImage, deg) else { fail("rotate failed") }
            final = rotated
        }
    }
    guard let dest = CGImageDestinationCreateWithURL(
        URL(fileURLWithPath: outPath) as CFURL, "public.jpeg" as CFString, 1, nil
    ) else { fail("cannot create destination") }
    // 只写像素，不带任何 EXIF/TIFF/GPS 元数据
    CGImageDestinationAddImage(dest, final, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { fail("finalize failed") }
    print("ok: \(outPath)")
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: ocr|orient|fix|strip ...") }

switch args[1] {
case "ocr":
    guard args.count >= 3 else { fail("usage: ocr <image>") }
    runOcr(args[2])
case "orient":
    guard args.count >= 3 else { fail("usage: orient <image>") }
    print(exifOrientationValue(args[2]))
case "fix":
    guard args.count >= 4 else { fail("usage: fix <in> <out>") }
    rewrite(args[2], args[3], rotate: true)
case "strip":
    guard args.count >= 4 else { fail("usage: strip <in> <out>") }
    rewrite(args[2], args[3], rotate: false)
default:
    fail("unknown subcommand: \(args[1])")
}
