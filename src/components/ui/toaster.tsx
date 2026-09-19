"use client"

import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { CheckCircle2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const isDestructive = variant === "destructive"

        return (
          <Toast key={id} variant={variant} {...props}>
            <div className="flex gap-3.5 items-start flex-1 min-w-0 pr-4">
              <div
                className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border shadow-inner transition-all",
                  isDestructive
                    ? "bg-red-500/15 border-red-500/30 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.2)]"
                    : "bg-[#82DB7E]/15 border-[#82DB7E]/30 text-[#82DB7E] shadow-[0_0_12px_rgba(130,219,126,0.2)]"
                )}
              >
                {isDestructive ? (
                  <AlertCircle className="w-4 h-4 stroke-[2.2]" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 stroke-[2.2]" />
                )}
              </div>
              <div className="grid gap-0.5 min-w-0 flex-1">
                {title && (
                  <ToastTitle className="text-[13.5px] font-bold text-white tracking-tight leading-tight">
                    {title}
                  </ToastTitle>
                )}
                {description && (
                  <ToastDescription className="text-xs text-white/70 leading-relaxed font-normal">
                    {description}
                  </ToastDescription>
                )}
              </div>
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}

