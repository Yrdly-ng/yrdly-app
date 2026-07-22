export default function Topbar() {
  return (
    <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200">
      <input
        type="text"
        placeholder="Search for events, items"
        className="w-1/2 rounded-lg border border-gray-200 px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500"
      />

      <div className="flex items-center space-x-4">
        <button className="text-gray-500 hover:text-blue-600">📍</button>
        <button className="text-gray-500 hover:text-blue-600">🔔</button>
        <button className="text-gray-500 hover:text-blue-600">💬</button>
        <img src="/avatar.png" className="w-8 h-8 rounded-full" />
      </div>
    </header>
  );
}
