import PageShell from "@/components/PageShell";

export default function Home() {
  return (
    <PageShell>
      <section className="bg-slate-50 py-16">
        <div className="mx-auto max-w-5xl px-4">
          <h1 className="text-4xl font-semibold">Find a Home With Kyle</h1>
          <div className="mt-6 flex gap-2">
            <input placeholder="Search Area, City, or Zip..." className="flex-1 rounded-xl border px-4 py-3" />
            <button className="rounded-xl bg-slate-900 px-6 py-3 text-white hover:bg-slate-950">Search</button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2">
        <div>
          <h2 className="text-3xl font-semibold">Where Your Real Estate Dreams Come True!</h2>
          <p className="mt-4 max-w-3xl text-slate-600">
            We offer full-service representation, local market expertise, and technology-powered support for every step in your move.
          </p>
          <button className="mt-6 rounded-xl bg-slate-900 px-6 py-3 text-white hover:bg-slate-950">Contact Us</button>
        </div>
        <form className="rounded-2xl border p-6 shadow-sm">
          <h3 className="text-xl font-semibold">Get Listing Alerts</h3>
          <p className="mt-2 text-sm text-slate-600">Tell us what you&apos;re searching for and we&apos;ll send matching homes.</p>
          <div className="mt-4 space-y-3">
            <input className="w-full rounded-xl border px-3 py-2" placeholder="Name" />
            <input className="w-full rounded-xl border px-3 py-2" placeholder="Email" />
            <input className="w-full rounded-xl border px-3 py-2" placeholder="Preferred Area" />
            <button className="w-full rounded-xl bg-slate-900 px-4 py-2 text-white">Submit</button>
          </div>
        </form>
      </section>

      <section className="bg-slate-50 py-16 text-center">
        <h2 className="text-3xl font-semibold">Buying &amp; Selling</h2>
        <p className="mt-2 text-slate-600">Whether you&apos;re ready to buy or sell, get a tailored plan and concierge-level guidance.</p>
      </section>
    </PageShell>
  );
}
