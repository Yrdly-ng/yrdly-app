import { Home, Users, Store, Calendar, Briefcase } from "lucide-react";

export default function Sidebar() {
  const items = [
    { icon: <Home size={22} />, label: "Home", href: "/home" },
    { icon: <Users size={22} />, label: "Community", href: "/community" },
    { icon: <Store size={22} />, label: "Market", href: "/market" },
    { icon: <Calendar size={22} />, label: "Events", href: "/events" },
    { icon: <Briefcase size={22} />, label: "Business", href: "/business" },
  ];

  return (
    <aside className="h-screen w-20 bg-white border-r border-gray-200 flex flex-col justify-between">
      <div className="flex flex-col items-center mt-6 space-y-6">
        {items.map((item, i) => (
          <a key={i} href={item.href} className="flex flex-col items-center text-gray-600 hover:text-blue-600">
            {item.icon}
            <span className="text-xs mt-1">{item.label}</span>
          </a>
        ))}
      </div>

      <div className="flex flex-col items-center mb-6 space-y-4">
        <img src="/avatar.png" className="w-8 h-8 rounded-full" />
      </div>
    </aside>
  );
}
