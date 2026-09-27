import Foundation

/// Scalar text follows Tao's display contract: whole numbers have no fractional suffix.
enum TaoValues {
    /// Match JavaScript Object.is for the numeric equality Tao uses on every host.
    static func equal(_ left: Double, _ right: Double) -> Bool {
        if left.isNaN { return right.isNaN }
        if left == 0 && right == 0 { return left.sign == right.sign }
        return left == right
    }

    /// Swift String equality normalizes Unicode; Tao text equality compares UTF-16 code units.
    static func equal(_ left: String, _ right: String) -> Bool {
        left.utf16.elementsEqual(right.utf16)
    }

    static func text(_ value: Double) -> String {
        if value.isNaN { return "NaN" }
        if value == .infinity { return "Infinity" }
        if value == -.infinity { return "-Infinity" }
        if value == 0 { return "0" }
        let text = String(value)
        return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
    }

    static func text(_ value: String) -> String { value }
    static func text(_ value: Bool) -> String { value ? "true" : "false" }
}
