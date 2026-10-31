import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Star } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Table,
  Tabs,
  Text,
  toast,
} from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

type ReviewStatus = "pending" | "approved" | "rejected"

type AdminReview = {
  id: string
  display_name: string
  rating: number
  title: string | null
  body: string
  status: ReviewStatus
  verified_purchase: boolean
  created_at: string
  product: { id: string; title: string; handle: string } | null
}

type ReviewListResponse = {
  reviews: AdminReview[]
  count: number
  limit: number
  offset: number
}

const PAGE_SIZE = 20

const STATUS_COLOR: Record<ReviewStatus, "orange" | "green" | "red"> = {
  pending: "orange",
  approved: "green",
  rejected: "red",
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || `Request failed (${response.status})`)
  }
  return response.json()
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-ui-tag-orange-icon whitespace-nowrap" aria-label={`${rating} of 5`}>
      {"★".repeat(rating)}
      <span className="text-ui-fg-disabled">{"★".repeat(5 - rating)}</span>
    </span>
  )
}

const ReviewsPage = () => {
  const [status, setStatus] = useState<ReviewStatus>("pending")
  const [page, setPage] = useState(0)
  const queryClient = useQueryClient()

  const { data, isLoading, isError } = useQuery({
    queryKey: ["product-reviews", status, page],
    queryFn: () =>
      request<ReviewListResponse>(
        `/admin/product-reviews?status=${status}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
      ),
  })

  const { mutate, isPending } = useMutation({
    mutationFn: (input: { ids: string[]; status: ReviewStatus }) =>
      request("/admin/product-reviews/status", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_, input) => {
      toast.success(`Review ${input.status}`)
      queryClient.invalidateQueries({ queryKey: ["product-reviews"] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const reviews = data?.reviews ?? []
  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE))

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div>
          <Heading level="h1">Reviews</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            New reviews stay hidden on the shop until you approve them.
          </Text>
        </div>
        <Tabs
          value={status}
          onValueChange={(value) => {
            setStatus(value as ReviewStatus)
            setPage(0)
          }}
        >
          <Tabs.List>
            <Tabs.Trigger value="pending">Pending</Tabs.Trigger>
            <Tabs.Trigger value="approved">Approved</Tabs.Trigger>
            <Tabs.Trigger value="rejected">Rejected</Tabs.Trigger>
          </Tabs.List>
        </Tabs>
      </div>

      {isError ? (
        <Text className="text-ui-fg-error px-6 py-8">Could not load reviews.</Text>
      ) : isLoading ? (
        <Text className="text-ui-fg-subtle px-6 py-8">Loading...</Text>
      ) : !reviews.length ? (
        <Text className="text-ui-fg-subtle px-6 py-8">No {status} reviews.</Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Product</Table.HeaderCell>
              <Table.HeaderCell>Rating</Table.HeaderCell>
              <Table.HeaderCell>Review</Table.HeaderCell>
              <Table.HeaderCell>Customer</Table.HeaderCell>
              <Table.HeaderCell>Date</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {reviews.map((review) => (
              <Table.Row key={review.id} className="align-top">
                <Table.Cell className="max-w-[180px] py-3">
                  {review.product ? (
                    <a
                      href={`/app/products/${review.product.id}`}
                      className="text-ui-fg-interactive hover:underline"
                    >
                      {review.product.title}
                    </a>
                  ) : (
                    <Text size="small" className="text-ui-fg-muted">
                      Deleted product
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell className="py-3">
                  <Stars rating={review.rating} />
                </Table.Cell>
                <Table.Cell className="max-w-[360px] py-3">
                  {review.title && (
                    <Text size="small" weight="plus">
                      {review.title}
                    </Text>
                  )}
                  <Text size="small" className="text-ui-fg-subtle whitespace-pre-line">
                    {review.body}
                  </Text>
                </Table.Cell>
                <Table.Cell className="py-3">
                  <Text size="small">{review.display_name}</Text>
                  {review.verified_purchase && (
                    <Badge size="2xsmall" color="green">
                      Verified buyer
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell className="py-3 whitespace-nowrap">
                  {new Date(review.created_at).toLocaleDateString("en-IN")}
                </Table.Cell>
                <Table.Cell className="py-3">
                  <div className="flex justify-end gap-2">
                    <Badge size="2xsmall" color={STATUS_COLOR[review.status]}>
                      {review.status}
                    </Badge>
                    {review.status !== "approved" && (
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={isPending}
                        onClick={() => mutate({ ids: [review.id], status: "approved" })}
                      >
                        Approve
                      </Button>
                    )}
                    {review.status !== "rejected" && (
                      <Button
                        size="small"
                        variant="danger"
                        disabled={isPending}
                        onClick={() => mutate({ ids: [review.id], status: "rejected" })}
                      >
                        Reject
                      </Button>
                    )}
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 px-6 py-3">
          <Text size="small" className="text-ui-fg-subtle">
            Page {page + 1} of {pageCount}
          </Text>
          <Button
            size="small"
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Reviews",
  icon: Star,
})

export default ReviewsPage
