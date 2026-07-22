"use client";

import { Button } from "@/components/ui/button";
import { MagnifyingGlass, MapPin, ChatCircle, Bell } from "@phosphor-icons/react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function Topbar({
  unreadMessages,
  unreadNotifications,
  onSearch,
  onNotifications,
  onProfile,
  profile,
  title = "Home",
}) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center px-6 bg-white border-b border-gray-100 h-[84px]">
      <div className="w-full flex items-center gap-4">
        <Link href="/home" className="flex items-center gap-3 flex-shrink-0 lg:w-64">
          <img src="/logo.png" alt="Yrdly" className="h-9 w-9 object-contain flex-shrink-0" />
          <span className="text-xl font-bold text-gray-900 truncate">{title}</span>
        </Link>

        <div className="flex-1 flex justify-center px-2">
          <button
            type="button"
            onClick={onSearch}
            className="w-full max-w-lg h-11 flex items-center gap-3 px-5 text-left rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            <MagnifyingGlass weight="bold" className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <span className="font-normal text-sm text-gray-400 truncate">
              Search for events, items
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          <Link href="/map">
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-500 hover:bg-gray-50 hover:text-gray-700 rounded-full"
            >
              <MapPin weight="bold" className="w-5 h-5" />
            </Button>
          </Link>

          <Link href="/messages">
            <Button
              variant="ghost"
              size="icon"
              className="relative text-gray-500 hover:bg-gray-50 hover:text-gray-700 rounded-full"
            >
              <ChatCircle weight="bold" className="w-5 h-5" />
              {unreadMessages > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 border border-white" />
              )}
            </Button>
          </Link>

          <Button
            variant="ghost"
            size="icon"
            className="relative text-gray-500 hover:bg-gray-50 hover:text-gray-700 rounded-full"
            onClick={onNotifications}
          >
            <Bell weight="bold" className="w-5 h-5" />
            {unreadNotifications > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 border border-white" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="rounded-full overflow-hidden p-0.5 ml-1"
            onClick={onProfile}
          >
            <Avatar className="w-9 h-9 rounded-full">
              <AvatarImage src={profile?.avatar_url || ""} />
              <AvatarFallback className="bg-[#8B6F5C] text-white font-bold">
                {profile?.name?.charAt(0).toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
          </Button>
        </div>
      </div>
    </header>
  );
}
