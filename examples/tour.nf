(* A tour of NF# in one file.  Run it with:  nf examples/tour.nf *)

// ---------------------------------------------------------------- values

let greeting name = "Hello, " ^ name ^ "!"

do println (greeting "world")

// Nothing below is annotated: every type here is inferred.
let double x = x * 2
let squares = map (fun x -> x * x) (range 1 6)

do println (show squares)
do println (show (map double squares))

// ------------------------------------------------------ partial application

// Functions are curried, so applying too few arguments returns a function.
let add a b = a + b
let increment = add 1

do println (show (map increment [10; 20; 30]))

// `|>` feeds a value into the next function, left to right.
do
  range 1 11
  |> filter odd
  |> map (fun n -> n * n)
  |> sum
  |> string_of_int
  |> println

// -------------------------------------------------------------- polymorphism

// `swap` works for any pair; the checker gives it the most general type.
let swap (a, b) = (b, a)

do println (show (swap (1, "one")))
do println (show (swap (true, [1; 2])))

// ------------------------------------------------------------ pattern matching

let describe xs =
  match xs with
  | [] -> "empty"
  | x :: [] -> "just " ^ show x
  | x :: y :: _ -> "starts with " ^ show x ^ " and " ^ show y

do println (describe ([] : int list))
do println (describe [42])
do println (describe [1; 2; 3])

// ------------------------------------------------------------------ options

let lookup key = assoc key [("one", 1); ("two", 2); ("three", 3)]

do println (show (lookup "two"))
do println (show (lookup "ten"))
do println (string_of_int (with_default 0 (lookup "ten")))

// ------------------------------------------------------------- local defines

let variance xs =
  let n = length xs in
  let mean = sum xs / n in
  let deviation x = (x - mean) * (x - mean) in
  sum (map deviation xs) / n

do println ("variance: " ^ string_of_int (variance [2; 4; 4; 4; 5; 5; 7; 9]))
