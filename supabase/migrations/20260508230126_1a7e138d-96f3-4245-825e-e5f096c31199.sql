REVOKE EXECUTE ON FUNCTION public.formula_c_candidates(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.formula_c_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.formula_c_candidates(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.formula_c_status() TO service_role;