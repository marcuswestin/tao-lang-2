insert into instant_users (id, email)
values (
  '90200000-0000-4000-8000-000000000001'::uuid,
  'local-dev@instantdb.local'
)
on conflict (id) do nothing;

insert into apps (id, creator_id, title)
values (
  :'app_id'::uuid,
  '90200000-0000-4000-8000-000000000001'::uuid,
  'Tao local development'
)
on conflict (id) do nothing;

insert into app_members (id, app_id, user_id, member_role)
values (
  '90200000-0000-4000-8000-000000000002'::uuid,
  :'app_id'::uuid,
  '90200000-0000-4000-8000-000000000001'::uuid,
  'owner'
)
on conflict (app_id, user_id) do nothing;

insert into rules (app_id, code)
values (
  :'app_id'::uuid,
  '{}'::jsonb
)
on conflict (app_id) do nothing;
