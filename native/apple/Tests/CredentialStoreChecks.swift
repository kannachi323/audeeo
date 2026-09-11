import Foundation
import Security
import LocalAuthentication

@main struct CredentialStoreChecks {
    static func main() {
        let key = "audeeo-test-" + UUID().uuidString
        let query = credentialQuery(key)
        assert(query[kSecAttrService as String] as? String == "com.mattdev727.audeeo")
        assert((query[kSecUseAuthenticationContext as String] as? LAContext)?.interactionNotAllowed == true)
        assert(CFEqual(query[kSecUseAuthenticationUI as String] as! CFString, kSecUseAuthenticationUIFail))
        let completed = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .userInitiated).async {
            defer { completed.signal() }
            key.withCString { raw in
                var status: Int32 = 0
                let missing = secretGet(raw, &status)
                assert(missing == nil && status == errSecItemNotFound, "Missing-item status must remain distinguishable from denied access: \(status)")
                let added = "synthetic-test-value".withCString { secretSet(raw, $0) }
                guard added == errSecSuccess else {
                    print("Noninteractive Keychain write unavailable (\(added)); real CRUD not verified.")
                    return
                }
                defer { assert(secretSet(raw, nil) == errSecSuccess) }
                let value = secretGet(raw, &status)
                assert(status == errSecSuccess && value != nil)
                assert(String(cString: value!) == "synthetic-test-value")
                secretFree(value)
                assert("updated-test-value".withCString { secretSet(raw, $0) } == errSecSuccess)
                let updated = secretGet(raw, &status)
                assert(status == errSecSuccess && String(cString: updated!) == "updated-test-value")
                secretFree(updated)
                print("Real noninteractive Keychain CRUD passed using an isolated synthetic item; user credentials untouched.")
            }
        }
        // Keep servicing the main run loop while the Security framework runs elsewhere.
        while completed.wait(timeout: .now()) != .success {
            RunLoop.main.run(until: Date().addingTimeInterval(0.01))
        }
        print("Credential policy and background-thread checks passed.")
    }
}
