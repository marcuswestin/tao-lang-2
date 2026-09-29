import Foundation

/// Scalar text follows Tao's display contract.
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
        let parts = text.lowercased().split(separator: "e", omittingEmptySubsequences: false)
        if parts.count == 1 {
            return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
        }

        let exponent = Int(parts[1])!
        let negative = parts[0].hasPrefix("-")
        let mantissa = negative ? parts[0].dropFirst() : parts[0][...]
        let digits = mantissa.filter { $0 != "." }
        let wholeDigits = mantissa.firstIndex(of: ".")
            .map { mantissa.distance(from: mantissa.startIndex, to: $0) } ?? mantissa.count
        let decimalPosition = wholeDigits + exponent
        let prefix = negative ? "-" : ""

        // ECMAScript uses fixed notation from 10^-6 through values below 10^21.
        if abs(value) >= 1e-6 && abs(value) < 1e21 {
            if decimalPosition <= 0 {
                return prefix + "0." + String(repeating: "0", count: -decimalPosition) + digits
            }
            if decimalPosition >= digits.count {
                return prefix + digits + String(repeating: "0", count: decimalPosition - digits.count)
            }
            let split = digits.index(digits.startIndex, offsetBy: decimalPosition)
            return prefix + String(digits[..<split]) + "." + String(digits[split...])
        }

        let significand = String(parts[0]).hasSuffix(".0") ? String(parts[0].dropLast(2)) : String(parts[0])
        return significand + "e" + (exponent >= 0 ? "+" : "") + String(exponent)
    }

    static func text(_ value: String) -> String { value }
    static func text(_ value: Bool) -> String { value ? "true" : "false" }
}
