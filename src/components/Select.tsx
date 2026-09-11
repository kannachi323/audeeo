import {useEffect, useRef, useState} from "react";
import * as SelectPrimitive from '@radix-ui/react-select';
import {Check, ChevronDown, ChevronUp} from 'lucide-react';

// Same Radix primitive and visual treatment as Misty's shared/ui/select.
export function Select<T extends string>({label, value, onChange, options, disabled}: {
  label: string; value: T; onChange: (value:T)=>void;
  options: readonly {value: T; label: string; disabled?: boolean}[]; disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open,setOpen] = useState(false);
  const closingClick = useRef(false);
  const [boundary,setBoundary] = useState<HTMLElement | null>(null);
  const reserveSpace = (open: boolean) => {
    if (!trigger.current?.closest('.detached-controls')) return;
    // Menus overlay subsequent fields, but need room below their own trigger.
    const bottom = open ? trigger.current.getBoundingClientRect().bottom + 4 + Math.min(240, options.length * 32 + 48) + 16 : 0;
    document.dispatchEvent(new CustomEvent('caption-select-space', {detail: bottom}));
  };
  useEffect(()=>()=>reserveSpace(false),[]);
  return <SelectPrimitive.Root open={open} onOpenChange={open=>{setOpen(open);reserveSpace(open);if(open) setBoundary(trigger.current?.closest(".subtitle-panel") as HTMLElement | null);}} value={value} onValueChange={v=>onChange(v as T)} disabled={disabled}>
    <SelectPrimitive.Trigger ref={trigger} className="select-trigger" aria-label={label}
      style={{pointerEvents: open ? 'auto' : undefined}}
      onPointerDown={event=>{
        closingClick.current = false;
        if (open && event.button === 0 && !event.ctrlKey) {
          // Radix normally opens on pointerdown and disables outside pointer
          // events. Keep this trigger interactive so a second press toggles it.
          event.preventDefault();
          closingClick.current = true;
          setOpen(false); reserveSpace(false);
        }
      }}
      onClick={event=>{
        // Suppress Radix's touch/click fallback after the closing pointerdown.
        if (closingClick.current) { event.preventDefault(); closingClick.current = false; }
      }}>

      <SelectPrimitive.Value/><SelectPrimitive.Icon asChild><ChevronDown/></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content className="select-content" position="popper" side="top" align="start" sideOffset={4} avoidCollisions={true} collisionBoundary={boundary} collisionPadding={12} data-caption-select="" onEscapeKeyDown={e=>e.stopPropagation()}>
        <SelectPrimitive.ScrollUpButton className="select-scroll"><ChevronUp/></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="select-viewport">
          {options.map(option=><SelectPrimitive.Item key={option.value} value={option.value} disabled={option.disabled} className="select-item">
            <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator className="select-check"><Check/></SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>)}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="select-scroll"><ChevronDown/></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
