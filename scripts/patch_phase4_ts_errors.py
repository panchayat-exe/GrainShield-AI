from pathlib import Path

# Fix profile.tsx: btn.primary -> btn.maroon
pf = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/frontend/src/routes/profile.tsx")
text = pf.read_text(encoding="utf-8").replace("\r\n", "\n")
text = text.replace("btn.primary", "btn.maroon")
pf.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Fixed profile.tsx btn.primary -> btn.maroon")

# Fix help.tsx: JSX namespace issue - use React.JSX or just string type for a
hf = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/frontend/src/routes/help.tsx")
text = hf.read_text(encoding="utf-8").replace("\r\n", "\n")
# Change JSX.Element to React.ReactNode and add React import
text = text.replace(
    'import {\n  HelpCircle,\n  Camera,\n  CheckCircle2,\n  RefreshCw,\n  AlertCircle,\n  Clock,\n  MapPin,\n  Shield,\n} from "lucide-react";',
    'import React from "react";\nimport {\n  HelpCircle,\n  Camera,\n  CheckCircle2,\n  RefreshCw,\n  AlertCircle,\n  Clock,\n  MapPin,\n  Shield,\n} from "lucide-react";'
)
text = text.replace("a: string | JSX.Element;", "a: string | React.ReactNode;")
hf.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Fixed help.tsx JSX.Element -> React.ReactNode")
