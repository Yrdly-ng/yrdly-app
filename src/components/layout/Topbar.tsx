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
  profile
}) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center px-6 bg-white border-b border-gray-200 shadow-sm h-[84px]">
      <div className="w-full max-w-7xl mx-auto flex items-center gap-4">
        <Link href="/home" className="flex items-center gap-1.5 flex-shrink-0">
          <img
            src="/logo.png"
            alt="Yrdly"
            className="h-11 w-11 object-contain"
          />
        </Link>

        <div className="hidden md:flex flex-1 justify-center max-w-2xl mx-auto">
          <button
            type="button"
            onClick={onSearch}
            className="w-full max-w-md h-10 rounded-full bg-white border border-gray-200 flex items-center gap-3 px-4 text-left hover:border-blue-600 transition-colors"
          >
            <MagnifyingGlass weight="bold" className="h-5 w-5 text-gray-500" />
            <span className="font-light italic text-xs text-gray-500 truncate">
              Search for events, items
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden text-gray-600 hover:bg-gray-100 rounded-full"
            onClick={onSearch}
          >
            <MagnifyingGlass weight="bold" className="w-5 h-5" />
          </Button>

          <Link href="/map">
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-600 hover:bg-gray-100 rounded-full"
            >
              <MapPin weight="bold" className="w-5 h-5" />
            </Button>
          </Link>

          <Link href="/messages">
            <Button
              variant="ghost"
              size="icon"
              className="relative text-gray-600 hover:bg-gray-100 rounded-full"
            >
              <ChatCircle weight="fill" className="w-5 h-5" />
              {unreadMessages > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[0.5625rem] font-bold px-1 bg-blue-600 text-white border border-white">
                  {unreadMessages > 9 ? "9+" : unreadMessages}
                </span>
              )}
            </Button>
          </Link>

          <Button
            variant="ghost"
            size="icon"
            className="relative text-gray-600 hover:bg-gray-100 rounded-full"
            onClick={onNotifications}
          >
            <Bell weight="fill" className="w-5 h-5" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[0.5625rem] font-bold px-1 bg-blue-600 text-white border border-white">
                {unreadNotifications > 9 ? "9+" : unreadNotifications}
              </span>
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="rounded-full overflow-hidden p-0.5"
            onClick={onProfile}
          >
            <Avatar className="w-9 h-9 rounded-full">
              <AvatarImage src={profile?.avatar_url || ""} />
              <AvatarFallback className="bg-blue-600 text-white font-bold">
                {profile?.name?.charAt(0).toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
          </Button>
        </div>
      </div>
    </header>
  );
}
