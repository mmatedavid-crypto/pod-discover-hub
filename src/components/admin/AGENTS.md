# Admin component rules

- Admin traffic comparisons use `get_traffic_quality_v1` (Budapest days with explicit UTC bounds, same-URL repeats within 5 s in one visit dropped, bots separate, Search Console as its own measure), never raw `page_events` row counts, because ~35% of rows were remount copies and GSC clicks are not visits.
