-- Close default anon grants on the privileged group RPCs.
revoke all on function public.create_social_group(text,text,text,text,numeric,text,date) from public, anon;
revoke all on function public.join_social_group(text) from public, anon;
grant execute on function public.create_social_group(text,text,text,text,numeric,text,date) to authenticated;
grant execute on function public.join_social_group(text) to authenticated;
