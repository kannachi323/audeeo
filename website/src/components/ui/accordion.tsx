import type { ComponentProps } from 'react'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'

// shadcn's Radix composition, styled with this site's CSS instead of Tailwind.
export const Accordion = AccordionPrimitive.Root

export function AccordionItem({ className = '', ...props }: ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={`accordion-item ${className}`} {...props} />
}

export function AccordionTrigger({ children, className = '', ...props }: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return <AccordionPrimitive.Header className="accordion-header">
    <AccordionPrimitive.Trigger className={`accordion-trigger ${className}`} {...props}>
      {children}<ChevronDown className="accordion-chevron" aria-hidden="true" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
}

export function AccordionContent({ children, className = '', ...props }: ComponentProps<typeof AccordionPrimitive.Content>) {
  return <AccordionPrimitive.Content className={`accordion-content ${className}`} {...props}>
    <div className="accordion-content-inner">{children}</div>
  </AccordionPrimitive.Content>
}
