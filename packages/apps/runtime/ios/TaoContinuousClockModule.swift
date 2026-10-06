import Darwin
import ExpoModulesCore

public final class TaoContinuousClockModule: Module {
  private static let timebase: mach_timebase_info_data_t = {
    var info = mach_timebase_info_data_t()
    mach_timebase_info(&info)
    return info
  }()

  public func definition() -> ModuleDefinition {
    Name("TaoContinuousClock")

    Function("nowMilliseconds") { () -> Double in
      let nanoseconds = Double(mach_continuous_time())
        * Double(Self.timebase.numer)
        / Double(Self.timebase.denom)
      return nanoseconds / 1_000_000.0
    }
  }
}
