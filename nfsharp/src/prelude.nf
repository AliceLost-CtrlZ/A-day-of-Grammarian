(* The NF# prelude.

   Everything here is ordinary NF# source: it is parsed, type-checked and
   evaluated at startup by the same pipeline that runs your program. If the
   type checker has a hole in it, this file usually finds it first.

   Primitives that cannot be written in NF# (arithmetic, comparison, string
   operations, printing) live in src/builtins.ts. *)

// ---------------------------------------------------------------- basics

let not b = if b then false else true
let id x = x
let ignore _ = ()
let fst (a, _) = a
let snd (_, b) = b
let flip f a b = f b a
let compose f g = fun x -> f (g x)

let min a b = if a <= b then a else b
let max a b = if a >= b then a else b
let abs n = if n < 0 then 0 - n else n
let even n = n % 2 = 0
let odd n = n % 2 <> 0

let rec pow base n = if n <= 0 then 1 else base * pow base (n - 1)

// ----------------------------------------------------------------- lists

(* NF# optimises tail calls but not ordinary recursion, so the workhorses below
   are written with accumulators: they run in constant stack space on lists of
   any length. Functions where the natural definition is clearer — `take`,
   `zip`, `merge_by` — keep their structural shape and are bounded by the host
   stack, which is fine for the sizes they are meant for. *)

let rec fold_left f acc xs =
  match xs with
  | [] -> acc
  | x :: rest -> fold_left f (f acc x) rest

let rec fold_right f xs acc =
  match xs with
  | [] -> acc
  | x :: rest -> f x (fold_right f rest acc)

let rec rev_append xs ys =
  match xs with
  | [] -> ys
  | x :: rest -> rev_append rest (x :: ys)

let rev xs = rev_append xs []
let length xs = fold_left (fun n _ -> n + 1) 0 xs

let is_empty xs =
  match xs with
  | [] -> true
  | _ -> false

// `xs @ ys` is sugar for `append xs ys`.
let append xs ys = rev_append (rev xs) ys

let map f xs = rev (fold_left (fun acc x -> f x :: acc) [] xs)
let filter p xs = rev (fold_left (fun acc x -> if p x then x :: acc else acc) [] xs)

let rec iter f xs =
  match xs with
  | [] -> ()
  | x :: rest -> (f x; iter f rest)

let rec exists p xs =
  match xs with
  | [] -> false
  | x :: rest -> if p x then true else exists p rest

let rec for_all p xs =
  match xs with
  | [] -> true
  | x :: rest -> if p x then for_all p rest else false

let mem x xs = exists (fun y -> y = x) xs

let rec take n xs =
  if n <= 0 then []
  else
    match xs with
    | [] -> []
    | x :: rest -> x :: take (n - 1) rest

let rec drop n xs =
  if n <= 0 then xs
  else
    match xs with
    | [] -> []
    | _ :: rest -> drop (n - 1) rest

(* [a; a + 1; ...; b - 1], built back to front so it stays tail recursive. *)
let range a b =
  let rec go acc n = if n < a then acc else go (n :: acc) (n - 1) in
  go [] (b - 1)

let init n f = map f (range 0 n)
let repeat n x = map (fun _ -> x) (range 0 n)

let sum xs = fold_left (+) 0 xs
let product xs = fold_left (fun acc x -> acc * x) 1 xs

let concat xss = fold_right append xss []
let concat_map f xs = concat (map f xs)

let rec zip xs ys =
  match xs with
  | [] -> []
  | x :: xrest ->
    (match ys with
     | [] -> []
     | y :: yrest -> (x, y) :: zip xrest yrest)

let unzip pairs = (map fst pairs, map snd pairs)

let head xs =
  match xs with
  | [] -> failwith "head: empty list"
  | x :: _ -> x

let tail xs =
  match xs with
  | [] -> failwith "tail: empty list"
  | _ :: rest -> rest

let rec last xs =
  match xs with
  | [] -> failwith "last: empty list"
  | x :: [] -> x
  | _ :: rest -> last rest

let rec nth xs n =
  match xs with
  | [] -> failwith "nth: index out of bounds"
  | x :: rest -> if n <= 0 then x else nth rest (n - 1)

let maximum xs = fold_left max (head xs) xs
let minimum xs = fold_left min (head xs) xs

// --------------------------------------------------------------- sorting

(* Split a list into its even- and odd-indexed halves. *)
let rec halve xs =
  match xs with
  | [] -> ([], [])
  | x :: [] -> ([x], [])
  | x :: y :: rest ->
    let (left, right) = halve rest in
    (x :: left, y :: right)

let rec merge_by cmp xs ys =
  match xs with
  | [] -> ys
  | x :: xrest ->
    (match ys with
     | [] -> xs
     | y :: yrest ->
       if cmp x y <= 0 then x :: merge_by cmp xrest ys
       else y :: merge_by cmp xs yrest)

(* Merge sort: stable, O(n log n), and a decent workout for the type checker. *)
let rec sort_by cmp xs =
  match xs with
  | [] -> []
  | x :: [] -> [x]
  | _ ->
    let (left, right) = halve xs in
    merge_by cmp (sort_by cmp left) (sort_by cmp right)

let sort xs = sort_by compare xs

// --------------------------------------------------------------- options

type 'a option =
  | None
  | Some of 'a

let is_some o =
  match o with
  | None -> false
  | Some _ -> true

let is_none o = not (is_some o)

let with_default fallback o =
  match o with
  | None -> fallback
  | Some x -> x

let option_map f o =
  match o with
  | None -> None
  | Some x -> Some (f x)

let rec find p xs =
  match xs with
  | [] -> None
  | x :: rest -> if p x then Some x else find p rest

let rec assoc key pairs =
  match pairs with
  | [] -> None
  | (k, v) :: rest -> if k = key then Some v else assoc key rest

// --------------------------------------------------------------- strings

let string_join sep parts =
  match parts with
  | [] -> ""
  | first :: rest -> fold_left (fun acc part -> acc ^ sep ^ part) first rest

let string_rev s = string_join "" (rev (chars s))
let string_repeat n s = string_join "" (repeat n s)

(* Split on a single-character separator. *)
let split_on sep s =
  let (final, groups) =
    fold_left
      (fun (current, groups) c ->
         if c = sep then ("", current :: groups) else (current ^ c, groups))
      ("", [])
      (chars s)
  in
  rev (final :: groups)

let lines s = split_on "\n" s
let words s = filter (fun w -> w <> "") (split_on " " s)

// The annotation is what makes this a list printer rather than `show` twice over.
let print_list (xs : 'a list) = println (show xs)
