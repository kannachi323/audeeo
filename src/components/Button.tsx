import { forwardRef, type ButtonHTMLAttributes } from "react";
// Misty's shadcn-style slots/variants and dimensions, using the same semantic palette.
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "default" | "ghost" | "outline";
  }
>(({ variant = "ghost", className = "", type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    data-slot="button"
    data-variant={variant}
    className={`button ${className}`}
    {...props}
  />
));
Button.displayName = "Button";
