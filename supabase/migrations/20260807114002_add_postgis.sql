-- Enable PostGIS extension if it doesn't already exist
create extension if not exists postgis with schema extensions;

-- Add location_geom column to posts table to store geographic points
alter table public.posts 
add column if not exists location_geom geography(Point, 4326);

-- Add location_geom column to businesses table to store geographic points
alter table public.businesses 
add column if not exists location_geom geography(Point, 4326);

-- create index for faster spatial queries
create index if not exists posts_location_geom_idx 
on public.posts using gist (location_geom);

create index if not exists businesses_location_geom_idx 
on public.businesses using gist (location_geom);

-- RPC for searching posts by distance
create or replace function search_posts_by_distance(
  lat double precision,
  lng double precision,
  radius_meters double precision,
  filter_category text default null,
  filter_min_price double precision default null,
  filter_max_price double precision default null,
  filter_condition text default null,
  sort_order text default 'Newest'
) returns setof public.posts
language sql
security definer
set search_path = public
as $$
  select *
  from public.posts
  where
    category = 'For Sale'
    and (is_sold is false or is_sold is null)
    and location_geom is not null
    and st_dwithin(location_geom, st_point(lng, lat)::geography, radius_meters)
    and (filter_category is null or sub_category = filter_category)
    and (filter_min_price is null or price >= filter_min_price)
    and (filter_max_price is null or price <= filter_max_price)
    and (filter_condition is null or condition = filter_condition)
  order by
    case when sort_order = 'Price: Low to High' then price end asc nulls last,
    case when sort_order = 'Price: High to Low' then price end desc nulls last,
    case when sort_order = 'Newest' then created_at end desc nulls last,
    -- Distance sorting as a secondary default
    st_distance(location_geom, st_point(lng, lat)::geography) asc;
$$;
