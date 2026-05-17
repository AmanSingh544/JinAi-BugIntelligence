import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { GitBranch, ChevronDown, ChevronUp, CheckCircle2, XCircle, FileCode, Terminal } from 'lucide-react';
import { api, type Release, type ReleaseSourcemap } from '../api';
import { Pagination } from '../components/Pagination';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { cn, formatDateTime } from '../lib/utils';

interface ReleaseWithSourcemaps extends Release {
  _sourcemaps?: ReleaseSourcemap[];
  _sourcemapsLoading?: boolean;
  _sourcemapsExpanded?: boolean;
}

export default function ReleasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [releases, setReleases] = useState<ReleaseWithSourcemaps[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 10;

  useEffect(() => {
    if (!projectId) return;
    void fetchReleases();
  }, [projectId, page]);

  async function fetchReleases() {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.releases.list(projectId, page, limit);
      setReleases(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }

  async function toggleSourcemaps(releaseId: string) {
    if (!projectId) return;
    setReleases((prev) =>
      prev.map((r) => {
        if (r.id !== releaseId) return r;
        const next = { ...r, _sourcemapsExpanded: !r._sourcemapsExpanded };
        if (next._sourcemapsExpanded && !next._sourcemaps) {
          next._sourcemapsLoading = true;
          api.releases.listSourcemaps(projectId, releaseId)
            .then((res) => {
              setReleases((p) => p.map((x) => x.id === releaseId ? { ...x, _sourcemaps: res.items, _sourcemapsLoading: false } : x));
            })
            .catch(() => {
              setReleases((p) => p.map((x) => x.id === releaseId ? { ...x, _sourcemapsLoading: false } : x));
            });
        }
        return next;
      })
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-th-bg px-6 pt-2 pb-1 border-th-sub flex items-center justify-between">
        <h1 className="text-base font-bold text-th">Releases</h1>
        <p className="text-xs text-th-3 mt-0.5">{total.toLocaleString()} release{total !== 1 ? 's' : ''} tracked</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6 max-w-100% mx-auto w-full">

      {/* Setup hint */}
      <div className="flex items-start gap-3 bg-th-surface border border-th rounded-lg px-4 py-3 mb-5">
        <Terminal size={14} className="text-th-3 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-th-2">
            Sourcemaps upload automatically via the CLI in your CI/CD pipeline.
          </p>
          <code className="text-[10px] font-mono text-indigo-400 mt-1 block">npx @bug-intelligence/sourcemap-upload --release $VERSION --dir dist/</code>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : releases.length === 0 ? (
        <EmptyState
          icon={<GitBranch size={18} />}
          title="No releases yet"
          description="Releases are created when you upload sourcemaps via the CLI."
        />
      ) : (
        <div className="space-y-2">
          {releases.map((r, i) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className={cn(
                'bg-th-surface border border-th rounded-lg overflow-hidden transition-colors duration-150',
                r._sourcemapsExpanded && 'border-th'
              )}
            >
              <button
                className="w-full flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-th-surface-2/30 transition-colors duration-150"
                onClick={() => void toggleSourcemaps(r.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-md bg-th-surface-2 border border-th flex items-center justify-center">
                    <GitBranch size={13} className="text-th-2" />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold text-th">v{r.version}</div>
                    <div className="text-[10px] text-th-3">{formatDateTime(r.created_at)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-th-3">
                  <span className="text-[11px]">sourcemaps</span>
                  {r._sourcemapsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </div>
              </button>

              <AnimatePresence>
                {r._sourcemapsExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-th px-4 py-3">
                      {r._sourcemapsLoading ? (
                        <div className="space-y-2 py-2">
                          {[1,2,3].map(i => <Skeleton key={i} className="h-8" />)}
                        </div>
                      ) : !r._sourcemaps || r._sourcemaps.length === 0 ? (
                        <EmptyState
                          icon={<FileCode size={14} />}
                          title="No sourcemaps for this release"
                          className="py-6"
                        />
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left">
                                <th className="text-[10px] font-semibold text-th-3 uppercase tracking-widest pb-2 pr-4">File</th>
                                <th className="text-[10px] font-semibold text-th-3 uppercase tracking-widest pb-2 pr-4">Declared</th>
                                <th className="text-[10px] font-semibold text-th-3 uppercase tracking-widest pb-2 pr-4">Size</th>
                                <th className="text-[10px] font-semibold text-th-3 uppercase tracking-widest pb-2 pr-4">Status</th>
                                <th className="text-[10px] font-semibold text-th-3 uppercase tracking-widest pb-2">Hash</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800">
                              {r._sourcemaps.map((sm) => (
                                <tr key={sm.id}>
                                  <td className="py-2 pr-4 font-mono text-[10px] text-th-2 max-w-[200px] truncate">{sm.minified_filename}</td>
                                  <td className="py-2 pr-4 text-th-3 text-[10px] max-w-[150px] truncate">{sm.declared_file || '—'}</td>
                                  <td className="py-2 pr-4 text-th-3 tabular-nums">{sm.sourcemap_size ? `${(sm.sourcemap_size / 1024).toFixed(1)}KB` : '—'}</td>
                                  <td className="py-2 pr-4">
                                    {sm.sourcemap_parsed ? (
                                      <span className="flex items-center gap-1 text-green-400"><CheckCircle2 size={11} /> Parsed</span>
                                    ) : (
                                      <span className="flex items-center gap-1 text-red-400" title={sm.sourcemap_error || ''}><XCircle size={11} /> Failed</span>
                                    )}
                                  </td>
                                  <td className="py-2 font-mono text-[10px] text-th-3">{sm.content_hash ? sm.content_hash.slice(0, 8) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}

      </div>

      <div className="border-t border-th px-6 py-3">
        <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}
