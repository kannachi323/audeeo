import {createContext, useContext, useRef, useState} from "react";
import type {ReactNode} from "react";
import * as SelectPrimitive from '@radix-ui/react-select';
import {Check, ChevronDown, ChevronUp} from 'lucide-react';

const NativeSelectContext = createContext(false);

export function NativeSelectProvider({children}: {children: ReactNode}) {
  return <NativeSelectContext.Provider value>{children}</NativeSelectContext.Provider>;
}

// Same Radix primitive and visual treatment as Misty's shared/ui/select. Detached
// desktop controls opt into the platform select because its menu is allowed to
// cross the small controls WebView's native bounds without resizing that window.
export function Select<T extends string>({label, value, onChange, options, disabled}: {
  label: string; value: T; onChange: (value:T)=>void;
  options: readonly {value: T; label: string; icon?: ReactNode; disabled?: boolean}[]; disabled?: boolean;
}) {
  const native = useContext(NativeSelectContext);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open,setOpen] = useState(false);
  const closingClick = useRef(false);
  const blockReopen = useRef(false);
  const closeGuardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [boundary,setBoundary] = useState<HTMLElement | null>(null);
  if (native) return <span className="native-select-field"><select className="select-trigger native-select" aria-label={label} value={value} disabled={disabled}
    onChange={event=>onChange(event.currentTarget.value as T)}>
    {options.map(option=><option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
  </select><ChevronDown aria-hidden="true"/></span>;
  return <SelectPrimitive.Root open={open} onOpenChange={nextOpen=>{
    if (nextOpen && blockReopen.current) return;
    setOpen(nextOpen);
    if(nextOpen) setBoundary(trigger.current?.closest(".subtitle-panel") as HTMLElement | null);
  }} value={value} onValueChange={v=>onChange(v as T)} disabled={disabled}>
    <SelectPrimitive.Trigger ref={trigger} className="select-trigger" aria-label={label}
      style={{pointerEvents: open ? 'auto' : undefined}}
      onPointerDownCapture={event=>{
        closingClick.current = false;
        if (open && event.button === 0 && !event.ctrlKey) {
          // Radix opens on pointerdown. Intercept the second press before its
          // trigger handler runs so closing cannot be followed by a reopen.
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          closingClick.current = true;
          blockReopen.current = true;
          if (closeGuardTimer.current) clearTimeout(closeGuardTimer.current);
          // A cancelled pointer sequence may not produce a click. Release the
          // guard eventually without allowing that same press to reopen it.
          closeGuardTimer.current = setTimeout(()=>{
            closingClick.current = false;
            blockReopen.current = false;
            closeGuardTimer.current = null;
          },500);
          setOpen(false);
        }
      }}
      onClickCapture={event=>{
        // Suppress Radix's touch/click fallback after the closing pointerdown.
        if (closingClick.current) {
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          if (closeGuardTimer.current) clearTimeout(closeGuardTimer.current);
          closeGuardTimer.current = setTimeout(()=>{
            closingClick.current = false;
            blockReopen.current = false;
            closeGuardTimer.current = null;
          },0);
        }
      }}>

      <SelectPrimitive.Value/><SelectPrimitive.Icon asChild><ChevronDown/></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content className="select-content" position="popper" side="top" align="start" sideOffset={4} avoidCollisions={true} collisionBoundary={boundary} collisionPadding={12} data-caption-select="" onEscapeKeyDown={e=>e.stopPropagation()}>
        <SelectPrimitive.ScrollUpButton className="select-scroll"><ChevronUp/></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="select-viewport">
          {options.map(option=><SelectPrimitive.Item key={option.value} value={option.value} disabled={option.disabled} className="select-item">
            <SelectPrimitive.ItemText><span className="select-item-label">{option.icon}{option.label}</span></SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator className="select-check"><Check/></SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>)}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="select-scroll"><ChevronDown/></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
