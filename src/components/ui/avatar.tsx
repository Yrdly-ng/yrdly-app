"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"
import { getImageProps } from "next/image"

import { cn } from "@/lib/shared/utils"

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className
    )}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, src, onLoadingStatusChange, ...props }, ref) => {
  const [failedSource, setFailedSource] = React.useState<string>();
  const publicAvatar =
    typeof src === "string" &&
    /^https:\/\/(?:api\.yrdly\.ng|yoiyqxtpmxnrrbqqidcs\.supabase\.co)\/storage\/v1\/object\/public\/user-avatars\//.test(src)
      ? src
      : undefined;
  const optimizedSource = publicAvatar && failedSource !== publicAvatar
    ? getImageProps({ src: publicAvatar, alt: "", width: 128, height: 128 }).props.src
    : undefined;

  return (
    <AvatarPrimitive.Image
      {...props}
      ref={ref}
      src={optimizedSource || src}
      className={cn("aspect-square h-full w-full object-cover", className)}
      onLoadingStatusChange={(status) => {
        if (status === "error" && optimizedSource) {
          setFailedSource(publicAvatar);
          return;
        }
        onLoadingStatusChange?.(status);
      }}
    />
  );
})
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }
