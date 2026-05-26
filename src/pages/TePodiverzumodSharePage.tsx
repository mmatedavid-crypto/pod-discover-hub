// Legacy share URL (/te-podiverzumod/eredmeny/:slug) → új kanonikus
// /hallgatoi-profil/:shareId route. Backward compatibility a régi linkekhez.

import { Navigate, useParams } from "react-router-dom";

export default function TePodiverzumodSharePage() {
  const { slug } = useParams<{ slug: string }>();
  return <Navigate to={`/hallgatoi-profil/${slug ?? ""}`} replace />;
}
