export default function Footer() {
  return (
    <footer className="border-t bg-slate-50">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm text-slate-600 md:grid-cols-3">
        <div>
          <h3 className="font-semibold text-slate-900">Legal</h3>
          <p className="mt-2">All information is deemed reliable but not guaranteed.</p>
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">IDX Disclaimer</h3>
          <p className="mt-2">Listing information provided by participating MLS boards.</p>
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Brokerage</h3>
          <p className="mt-2">Southeast Miami Realty • Licensed in Florida.</p>
        </div>
      </div>
    </footer>
  );
}
