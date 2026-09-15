import { X } from "lucide-react";
import { Button } from "./Button";
import { CaptionProviderLogo } from "./CaptionProviderLogo";
import { Select } from "./Select";
import {
  captionProviders,
  type ProviderId,
  type ProviderKeys,
  type ProviderMode,
} from "../lib/providers";

export function ProviderSettings({mode, keys, active, onMode, onKey, onSubscription}: {
  mode: ProviderMode;
  keys: ProviderKeys;
  active: boolean;
  onMode: (mode: ProviderMode) => void;
  onKey: (provider: ProviderId, key: string) => void;
  onSubscription: () => void;
}) {
  const selected = captionProviders.find(provider => provider.id === mode);
  return <section className="provider-settings" aria-label="Provider settings">
    <div className="provider-select-field">
      <label>
        Provider
        <Select
          label="Caption provider"
          value={mode}
          disabled={active}
          onChange={onMode}
          options={[
            {value: "audeeo", label: "Audeeo", icon: <CaptionProviderLogo provider="audeeo"/>},
            ...captionProviders.map(provider => ({
              value: provider.id,
              label: provider.name,
              icon: <CaptionProviderLogo provider={provider.id}/>,
            })),
          ]}
        />
      </label>
    </div>

    {mode === "audeeo" ? <Button className="provider-subscription-button" variant="outline" disabled={active} onClick={onSubscription}>
      View subscription
    </Button> : selected ? <section aria-label={`${selected.name} credentials`}>
      <div className="provider-key-field">
        <label htmlFor={`provider-key-${selected.id}`}>{selected.name} API key</label>
        <div>
          <input id={`provider-key-${selected.id}`} type="password" value={keys[selected.id]} disabled={active}
            autoComplete="off" spellCheck={false} maxLength={512} placeholder={selected.keyPlaceholder}
            onChange={event => onKey(selected.id, event.target.value)}/>
          {keys[selected.id] && <Button className="icon-button" variant="outline" disabled={active}
            aria-label={`Clear ${selected.name} API key`} title="Clear key" onClick={() => onKey(selected.id, "")}><X aria-hidden="true"/></Button>}
        </div>
      </div>
    </section> : null}

  </section>;
}
