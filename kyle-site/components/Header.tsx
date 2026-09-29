import Link from "next/link";

const navItems = [
  { href: "/", label: "Home" },
  {
    href: "/search",
    label: "Search",
    children: [
      { href: "/search/local", label: "Local Search" },
      { href: "/search/featured", label: "Featured Listings" }
    ]
  },
  { href: "/buying", label: "Buying" },
  { href: "/selling", label: "Selling" },
  { href: "/communities/miami-beach", label: "Communities" },
  {
    href: "/about",
    label: "About",
    children: [
      { href: "/about/meet-kyle", label: "Meet Kyle" },
      { href: "/about/join", label: "Join" },
      { href: "/testimonials", label: "Testimonials" }
    ]
  },
  { href: "/contact", label: "Contact" }
];

export default function Header() {
  return (
    <header className="border-b">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img src="https://images.unsplash.com/photo-1546961329-78bef0414d7c?auto=format&fit=crop&w=140&q=80" alt="Kyle Kleinman" className="h-14 w-14 rounded-full object-cover" />
            <div>
              <div className="text-lg font-semibold">Kyle Kleinman</div>
              <div className="text-sm text-slate-600">(305) 972-4118 • kyle@southeast.miami</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/login" className="rounded-xl border px-4 py-2 text-sm">Login</Link>
            <Link href="/signup" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">Sign Up</Link>
          </div>
        </div>
        <nav className="mt-6 flex flex-wrap gap-6 text-sm font-medium">
          {navItems.map((item) => (
            <div key={item.href} className="group relative">
              <Link href={item.href} className="hover:text-slate-600">
                {item.label}
              </Link>
              {item.children ? (
                <div className="invisible absolute left-0 top-full z-10 mt-3 w-48 rounded-xl border bg-white p-2 opacity-0 shadow-md transition group-hover:visible group-hover:opacity-100">
                  {item.children.map((child) => (
                    <Link key={child.href} href={child.href} className="block rounded-lg px-3 py-2 hover:bg-slate-50">
                      {child.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </nav>
      </div>
    </header>
  );
}
