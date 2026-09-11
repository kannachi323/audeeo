#if os(iOS)
import Foundation
import Security
import LocalAuthentication

// Never let automatic auth refresh/session checks display a credential consent sheet.
// Keep the legacy UI policy as well as LAContext for existing macOS keychain items.
func credentialQuery(_ key: String) -> [String: Any] {
    let context = LAContext()
    context.interactionNotAllowed = true
    return [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.mattdev727.audeeo", kSecAttrAccount as String: key,
        kSecUseAuthenticationContext as String: context,
        kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail]
}

@_cdecl("audeeo_secret_get")
public func secretGet(_ rawKey: UnsafePointer<CChar>, _ result: UnsafeMutablePointer<Int32>) -> UnsafeMutablePointer<CChar>? {
    precondition(!Thread.isMainThread, "Keychain work must run on a blocking worker")
    var query = credentialQuery(String(cString: rawKey))
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    result.pointee = status
    guard status == errSecSuccess else { return nil }
    guard let data = item as? Data, let text = String(data: data, encoding: .utf8) else {
        result.pointee = errSecDecode; return nil
    }
    guard let pointer = strdup(text) else { result.pointee = errSecAllocate; return nil }
    return pointer
}
@_cdecl("audeeo_secret_set")
public func secretSet(_ rawKey: UnsafePointer<CChar>, _ rawValue: UnsafePointer<CChar>?) -> Int32 {
    precondition(!Thread.isMainThread, "Keychain work must run on a blocking worker")
    let query = credentialQuery(String(cString: rawKey))
    guard let rawValue else { let status = SecItemDelete(query as CFDictionary); return status == errSecItemNotFound ? errSecSuccess : status }
    let data = Data(String(cString: rawValue).utf8)
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status != errSecItemNotFound { return status }
    var attributes = query
    attributes[kSecValueData as String] = data
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(attributes as CFDictionary, nil)
}
#endif
import Foundation
@_cdecl("audeeo_secret_free")
public func secretFree(_ pointer: UnsafeMutablePointer<CChar>?) { free(pointer) }
