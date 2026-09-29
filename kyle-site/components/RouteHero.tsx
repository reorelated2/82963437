export default function RouteHero({ title, description }: { title: string; description: string }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-3 max-w-3xl text-slate-600">{description}</p>
    </section>
  );
}
