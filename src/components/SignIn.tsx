import { AudioLines } from "lucide-react";
import { Button } from "./Button";
export function SignIn({
  configured,
  pending,
  error,
  onSignIn,
  onRetry,
}: {
  configured: boolean;
  pending: boolean;
  error: string;
  onSignIn: (provider: "apple" | "google") => void;
  onRetry?: () => void;
}) {
  return (
    <main className="sign-in-window">
      <div className="sign-in-brand">
        <AudioLines aria-hidden="true" />
        <span>Audeeo</span>
      </div>
      <h1>Understand every word.</h1>
      <p className="sign-in-intro">
        Live captions and translation,
        <br />
        in a floating panel that stays with you.
      </p>
      <div className="social-actions">
        <Button
          variant="default"
          disabled={!configured || pending}
          onClick={() => onSignIn("apple")}
        >
          Continue with Apple
        </Button>
        <Button
          variant="outline"
          disabled={!configured || pending}
          onClick={() => onSignIn("google")}
        >
          Continue with Google
        </Button>
      </div>
      {error && (
        <p className="sign-in-error" role="alert">
          {error}
        </p>
      )}
      {error.includes("Keychain") && onRetry && <Button onClick={onRetry}>Retry Keychain</Button>}
      {pending && (
        <div>
          <p className="hint" role="status">
            Complete sign-in in your browser, then return to Audeeo.
          </p>
          {onRetry && <Button onClick={onRetry}>Try again</Button>}
        </div>
      )}
      {!configured && (
        <p className="setup-notice">
          Sign-in isn’t available in this build yet.
          <br />
          Account services need to be connected.
        </p>
      )}
      <p className="sign-in-footnote">
        Sign in to begin. Your saved captions sync across devices.
      </p>
    </main>
  );
}
