import Foundation

@_cdecl("audeeo_string_free")
public func stringFree(_ pointer: UnsafeMutablePointer<CChar>?) { free(pointer) }
