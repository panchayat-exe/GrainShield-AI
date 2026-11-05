from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/routes/reports.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# Fix the broken useState partial replacement
BAD_PATTERN = '''useState("All Time");
  const [trendData, setTrendData] = useState<{ date: string; total: number; pass: number; review: number }[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  useEffect(() => {
    getDailyTrend(30).then((d) => { setTrendData(d); setTrendLoading(false); });
  }, []'''

GOOD_PATTERN = '''useState("All Time");
  const [trendData, setTrendData] = useState<{ date: string; total: number; pass: number; review: number }[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);

  // Load daily trend on mount
  useEffect(() => {
    getDailyTrend(30).then((data) => {
      setTrendData(data);
      setTrendLoading(false);
    });
  }, []);'''

if BAD_PATTERN in text:
    text = text.replace(BAD_PATTERN, GOOD_PATTERN)
    print("Fixed broken useState/useEffect block")
else:
    print("Pattern not found — checking current state")
    idx = text.find("useState(\"All Time\")")
    print(repr(text[idx:idx+400]))

FILE.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Done")
