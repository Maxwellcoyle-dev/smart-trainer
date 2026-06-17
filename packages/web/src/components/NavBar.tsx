import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/", label: "Today", icon: "🏠" },
  { to: "/log", label: "Log", icon: "➕" },
  { to: "/progress", label: "Progress", icon: "📈" },
  { to: "/plan", label: "Plan", icon: "📋" },
  { to: "/coach", label: "Coach", icon: "🤖" },
];

export function NavBar() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-surface border-t border-border flex">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "/"}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
              isActive ? "text-accent" : "text-muted"
            }`
          }
        >
          <span className="text-lg leading-none">{tab.icon}</span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
